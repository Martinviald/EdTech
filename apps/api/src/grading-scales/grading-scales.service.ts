import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { gradingScales, instruments, type GradingScale } from '@soe/db';
import {
  percentageToGrade,
  userHasRole,
  type GradingScaleCreateDto,
  type GradingScaleListQueryDto,
  type GradingScaleListResponse,
  type GradingScalePreviewResponse,
  type GradingScaleResponseModel,
  type GradingScaleTypeValue,
  type GradingScaleUpdateDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

/**
 * H5.7 — Escalas de notas configurables por colegio. Cada escala traduce un
 * porcentaje de logro (0..1) a una nota usando interpolación lineal por
 * tramos, con un punto de quiebre en `passingThreshold` (ej. 60% → 4.0).
 *
 * Reglas de visibilidad:
 *  - Escalas globales (`org_id IS NULL`): visibles a todos, editables solo
 *    por platform_admin.
 *  - Escalas custom: visibles y editables solo por la org dueña.
 *
 * Las columnas decimal de Postgres llegan como `string` desde Drizzle; el
 * service las convierte a number en `toResponseModel` y persiste como
 * string en escrituras.
 */
@Injectable()
export class GradingScalesService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(user: JwtPayload, query: GradingScaleListQueryDto): Promise<GradingScaleListResponse> {
    const { page, limit, type, isGlobal } = query;

    const visibilityCondition = this.buildVisibilityCondition(user);
    const conditions = [visibilityCondition];

    if (type) {
      conditions.push(eq(gradingScales.type, type));
    }
    if (typeof isGlobal === 'boolean') {
      if (isGlobal) {
        conditions.push(isNull(gradingScales.orgId));
      } else if (user.orgId) {
        conditions.push(eq(gradingScales.orgId, user.orgId));
      } else {
        // Usuario sin orgId pidiendo "no globales" → no hay nada que ver.
        return { data: [], total: 0, page, limit };
      }
    }

    const whereClause = and(...conditions);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(gradingScales)
      .where(whereClause);

    const rows = await this.db
      .select()
      .from(gradingScales)
      .where(whereClause)
      .orderBy(gradingScales.name)
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data: rows.map((row) => this.toResponseModel(row)),
      total: Number(count ?? 0),
      page,
      limit,
    };
  }

  async getById(user: JwtPayload, id: string): Promise<GradingScaleResponseModel> {
    const row = await this.findVisibleById(user, id);
    return this.toResponseModel(row);
  }

  async create(
    user: JwtPayload,
    dto: GradingScaleCreateDto,
  ): Promise<GradingScaleResponseModel> {
    this.assertScaleInvariants(dto.minGrade, dto.passingGrade, dto.maxGrade, dto.passingThreshold);

    if (!user.orgId) {
      throw new ForbiddenException('Solo usuarios con una organización pueden crear escalas');
    }

    const [created] = await this.db
      .insert(gradingScales)
      .values({
        // Multi-tenancy: orgId SIEMPRE viene del JWT, nunca del body.
        orgId: user.orgId,
        name: dto.name,
        type: dto.type,
        minGrade: dto.minGrade.toFixed(2),
        maxGrade: dto.maxGrade.toFixed(2),
        passingGrade: dto.passingGrade.toFixed(2),
        passingThreshold: dto.passingThreshold.toFixed(2),
        config: dto.config ?? {},
      })
      .returning();

    if (!created) throw new BadRequestException('No se pudo crear la escala de notas');
    return this.toResponseModel(created);
  }

  async update(
    user: JwtPayload,
    id: string,
    dto: GradingScaleUpdateDto,
  ): Promise<GradingScaleResponseModel> {
    const existing = await this.findVisibleById(user, id);
    this.assertEditable(existing, user);

    // Validar invariante con los valores finales (mezcla de existing + dto).
    const finalMin = dto.minGrade ?? Number(existing.minGrade);
    const finalMax = dto.maxGrade ?? Number(existing.maxGrade);
    const finalPassing = dto.passingGrade ?? Number(existing.passingGrade);
    const finalThreshold = dto.passingThreshold ?? Number(existing.passingThreshold);
    this.assertScaleInvariants(finalMin, finalPassing, finalMax, finalThreshold);

    const [updated] = await this.db
      .update(gradingScales)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.minGrade !== undefined && { minGrade: dto.minGrade.toFixed(2) }),
        ...(dto.maxGrade !== undefined && { maxGrade: dto.maxGrade.toFixed(2) }),
        ...(dto.passingGrade !== undefined && { passingGrade: dto.passingGrade.toFixed(2) }),
        ...(dto.passingThreshold !== undefined && {
          passingThreshold: dto.passingThreshold.toFixed(2),
        }),
        ...(dto.config !== undefined && { config: dto.config }),
      })
      .where(eq(gradingScales.id, id))
      .returning();

    if (!updated) throw new BadRequestException('No se pudo actualizar la escala de notas');
    return this.toResponseModel(updated);
  }

  async delete(user: JwtPayload, id: string): Promise<void> {
    const existing = await this.findVisibleById(user, id);
    this.assertEditable(existing, user);

    // No se puede borrar si algún instrumento la referencia.
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(instruments)
      .where(eq(instruments.gradingScaleId, id));

    if (Number(count ?? 0) > 0) {
      throw new ConflictException(
        'No se puede eliminar: hay instrumentos usando esta escala',
      );
    }

    await this.db.delete(gradingScales).where(eq(gradingScales.id, id));
  }

  async previewConversion(
    user: JwtPayload,
    id: string,
    percentages: number[],
  ): Promise<GradingScalePreviewResponse> {
    const scale = await this.findVisibleById(user, id);
    const params = {
      minGrade: Number(scale.minGrade),
      maxGrade: Number(scale.maxGrade),
      passingGrade: Number(scale.passingGrade),
      passingThreshold: Number(scale.passingThreshold),
    };

    return {
      scaleId: scale.id,
      rows: percentages.map((percentage) => {
        const grade = percentageToGrade(percentage, params);
        return {
          percentage,
          grade,
          isPassing: grade >= params.passingGrade,
        };
      }),
    };
  }

  // ────────────────────────── helpers internos ──────────────────────────

  /**
   * SQL: `(org_id IS NULL OR org_id = :userOrgId)`. Un usuario sin orgId
   * (caso platform_admin sin membership) solo ve las globales.
   */
  private buildVisibilityCondition(user: JwtPayload) {
    if (!user.orgId) {
      return isNull(gradingScales.orgId);
    }
    return or(isNull(gradingScales.orgId), eq(gradingScales.orgId, user.orgId));
  }

  private async findVisibleById(user: JwtPayload, id: string): Promise<GradingScale> {
    const [row] = await this.db
      .select()
      .from(gradingScales)
      .where(and(eq(gradingScales.id, id), this.buildVisibilityCondition(user)));

    if (!row) throw new NotFoundException('Escala de notas no encontrada');
    return row;
  }

  /**
   * Las escalas globales (`orgId === null`) son inmutables salvo para
   * platform_admin. Las custom solo las edita su org dueña.
   */
  private assertEditable(scale: GradingScale, user: JwtPayload) {
    if (userHasRole(user.roles, 'platform_admin') || user.isPlatformAdmin) return;
    if (scale.orgId === null) {
      throw new ForbiddenException(
        'Las escalas globales solo pueden ser editadas por platform_admin',
      );
    }
    if (!user.orgId || scale.orgId !== user.orgId) {
      throw new ForbiddenException('Solo puedes editar escalas de tu propia organización');
    }
  }

  private assertScaleInvariants(
    minGrade: number,
    passingGrade: number,
    maxGrade: number,
    passingThreshold: number,
  ) {
    if (!(minGrade < passingGrade && passingGrade < maxGrade)) {
      throw new BadRequestException(
        'Las notas deben cumplir minGrade < passingGrade < maxGrade',
      );
    }
    if (!(passingThreshold > 0 && passingThreshold < 1)) {
      throw new BadRequestException('passingThreshold debe estar entre 0 y 1 (exclusivo)');
    }
  }

  private toResponseModel(row: GradingScale): GradingScaleResponseModel {
    return {
      id: row.id,
      orgId: row.orgId,
      isGlobal: row.orgId === null,
      name: row.name,
      type: row.type as GradingScaleTypeValue,
      minGrade: Number(row.minGrade),
      maxGrade: Number(row.maxGrade),
      passingGrade: Number(row.passingGrade),
      passingThreshold: Number(row.passingThreshold),
      config: (row.config ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
