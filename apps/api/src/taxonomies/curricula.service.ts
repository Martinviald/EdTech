import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { curricula, taxonomyNodes, type Curriculum } from '@soe/db';
import { userHasRole, type CreateCurriculumDto, type UpdateCurriculumDto } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class CurriculaService {
  constructor(@InjectDb() private readonly db: Database) {}

  async listVisible(user: JwtPayload, filters: { type?: string; isOfficial?: boolean } = {}) {
    const conditions = [
      user.isPlatformAdmin
        ? // platform_admins ven todos los currícula
          or(eq(curricula.isOfficial, true), eq(curricula.isOfficial, false))
        : user.orgId
          ? or(eq(curricula.isOfficial, true), eq(curricula.orgId, user.orgId))
          : eq(curricula.isOfficial, true),
    ];

    if (filters.type) {
      conditions.push(eq(curricula.type, filters.type as Curriculum['type']));
    }
    if (typeof filters.isOfficial === 'boolean') {
      conditions.push(eq(curricula.isOfficial, filters.isOfficial));
    }

    return this.db
      .select()
      .from(curricula)
      .where(and(...conditions))
      .orderBy(curricula.isOfficial, curricula.name);
  }

  async getById(id: string, user: JwtPayload) {
    const [row] = await this.db.select().from(curricula).where(eq(curricula.id, id));
    if (!row) throw new NotFoundException('Currículum no encontrado');
    this.assertVisible(row, user);
    return row;
  }

  async create(dto: CreateCurriculumDto, user: JwtPayload) {
    if (dto.isOfficial && !userHasRole(user.roles, 'platform_admin')) {
      throw new ForbiddenException('Solo platform_admin puede crear currícula oficiales');
    }

    const orgId = dto.isOfficial ? null : user.orgId;

    const [created] = await this.db
      .insert(curricula)
      .values({
        name: dto.name,
        type: dto.type,
        language: dto.language ?? 'es',
        version: dto.version,
        isOfficial: dto.isOfficial ?? false,
        orgId,
        metadata: dto.metadata ?? {},
      })
      .returning();

    if (!created) throw new BadRequestException('No se pudo crear el currículum');
    return created;
  }

  async update(id: string, dto: UpdateCurriculumDto, user: JwtPayload) {
    const existing = await this.getById(id, user);
    this.assertEditable(existing, user);

    const [updated] = await this.db
      .update(curricula)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.version !== undefined && { version: dto.version }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata }),
      })
      .where(eq(curricula.id, id))
      .returning();

    return updated;
  }

  async remove(id: string, user: JwtPayload) {
    const existing = await this.getById(id, user);
    this.assertEditable(existing, user);

    // taxonomy_nodes tiene onDelete: cascade — borra todo el árbol del curriculum.
    await this.db.delete(curricula).where(eq(curricula.id, id));
  }

  async getTree(id: string, user: JwtPayload) {
    const curriculum = await this.getById(id, user);
    const nodes = await this.db
      .select()
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.curriculumId, id))
      .orderBy(taxonomyNodes.depth, taxonomyNodes.order);

    return { curriculum, nodes };
  }

  /** Verifica que el currículum sea visible para el usuario (oficial, propio o platform_admin). */
  assertVisible(curriculum: Curriculum, user: JwtPayload) {
    if (user.isPlatformAdmin) return;
    if (curriculum.isOfficial) return;
    if (user.orgId && curriculum.orgId === user.orgId) return;
    throw new ForbiddenException('No tienes acceso a este currículum');
  }

  /**
   * Reglas de edición:
   * - platform_admin: puede editar cualquier currículum.
   * - Currícula oficiales (no admin): solo lectura.
   * - Currícula custom: school_admin de la misma org.
   */
  assertEditable(curriculum: Curriculum, user: JwtPayload) {
    if (user.isPlatformAdmin) return;
    if (curriculum.isOfficial) {
      throw new ForbiddenException('Los currícula oficiales son de solo lectura');
    }
    if (!user.orgId || curriculum.orgId !== user.orgId) {
      throw new ForbiddenException('Solo puedes editar currícula de tu propia organización');
    }
  }
}
