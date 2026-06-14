import { createHash } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { aiAnalyses, withOrgContext, type AiAnalysis } from '@soe/db';
import type {
  AiAnalysisModel,
  GenerateAnalysisDto,
  GenerateItemInsightDto,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

/**
 * Minutos tras los cuales un análisis en `processing` se considera obsoleto
 * (lazy stale recovery): si la fila de caché quedó colgada, un nuevo `create`
 * la trata como regenerable en vez de servirla o bloquear. El reaper (H19.20)
 * la marca `failed` de forma proactiva; esto es la red de seguridad perezosa.
 */
const DEFAULT_STALE_MINUTES = 10;

interface MarkCompletedInput {
  output: Record<string, unknown>;
  model: string | null;
  promptVersion: string | null;
  tokens: { input: number; output: number } | null;
  costUsd: string | null;
}

/**
 * Resultado de `create`: el registro de dominio más una bandera que indica si
 * provino de caché (para que el controller decida si encola o no el job).
 */
export interface CreateAnalysisResult {
  analysis: AiAnalysisModel;
  fromCache: boolean;
}

/**
 * Registro + caché de análisis IA (H19.23). Toda query a `ai_analyses` corre
 * dentro de `withOrgContext` (RLS por org_id); el `orgId` proviene SIEMPRE del
 * token (`user.orgId`), nunca del body. La salida del modelo vive solo en
 * `output`: nunca pisa datos deterministas de otras tablas.
 */
@Injectable()
export class AiAnalysisService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Crea (o reutiliza desde caché) un registro de análisis.
   *
   * - Calcula un `inputHash` determinista de {assessmentId, analysisType,
   *   audience, classGroupId}.
   * - Si existe una fila `completed` con ese hash y NO `force` → la devuelve
   *   (caché, `fromCache: true`).
   * - Lazy stale recovery: una fila `processing` con `startedAt` más viejo que
   *   `AI_ANALYSIS_STALE_MINUTES` se trata como obsoleta (permite regenerar).
   * - En cualquier otro caso inserta una fila `pending` y la devuelve.
   */
  async create(
    user: JwtPayload,
    assessmentId: string,
    dto: GenerateAnalysisDto,
  ): Promise<CreateAnalysisResult> {
    const orgId = this.requireOrgId(user);
    const inputHash = this.computeInputHash({
      assessmentId,
      analysisType: dto.analysisType,
      audience: dto.audience,
      classGroupId: dto.classGroupId ?? null,
    });

    return withOrgContext(this.db, orgId, async (tx) => {
      if (!dto.force) {
        const [existing] = await tx
          .select()
          .from(aiAnalyses)
          .where(
            and(
              eq(aiAnalyses.orgId, orgId),
              eq(aiAnalyses.inputHash, inputHash),
              isNull(aiAnalyses.deletedAt),
            ),
          )
          .orderBy(desc(aiAnalyses.createdAt))
          .limit(1);

        if (existing && this.isCacheable(existing)) {
          return { analysis: this.toModel(existing), fromCache: true };
        }
      }

      const [inserted] = await tx
        .insert(aiAnalyses)
        .values({
          orgId,
          assessmentId,
          classGroupId: dto.classGroupId ?? null,
          analysisType: dto.analysisType,
          audience: dto.audience,
          inputHash,
          status: 'pending',
          createdById: user.userId,
        })
        .returning();

      if (!inserted) {
        throw new Error('No se pudo crear el registro de análisis IA');
      }
      return { analysis: this.toModel(inserted), fromCache: false };
    });
  }

  /**
   * Crea (o reutiliza desde caché) un análisis POR-PREGUNTA (H20.8).
   *
   * Igual que `create`, pero el `inputHash` incluye `itemId` (además de
   * assessmentId, analysisType='item_insight', audience, classGroupId) y persiste
   * `input: { itemId, assessmentId }` en la fila (no hay columna itemId en S2).
   * `analysisType` queda fijado a 'item_insight'.
   */
  async createForItem(
    user: JwtPayload,
    itemId: string,
    dto: GenerateItemInsightDto,
  ): Promise<CreateAnalysisResult> {
    const orgId = this.requireOrgId(user);
    const analysisType = 'item_insight';
    const classGroupId = dto.classGroupId ?? null;
    const inputHash = this.computeInputHash({
      assessmentId: dto.assessmentId,
      analysisType,
      audience: dto.audience,
      classGroupId,
      itemId,
    });

    return withOrgContext(this.db, orgId, async (tx) => {
      if (!dto.force) {
        const [existing] = await tx
          .select()
          .from(aiAnalyses)
          .where(
            and(
              eq(aiAnalyses.orgId, orgId),
              eq(aiAnalyses.inputHash, inputHash),
              isNull(aiAnalyses.deletedAt),
            ),
          )
          .orderBy(desc(aiAnalyses.createdAt))
          .limit(1);

        if (existing && this.isCacheable(existing)) {
          return { analysis: this.toModel(existing), fromCache: true };
        }
      }

      const [inserted] = await tx
        .insert(aiAnalyses)
        .values({
          orgId,
          assessmentId: dto.assessmentId,
          classGroupId,
          analysisType,
          audience: dto.audience,
          inputHash,
          input: { itemId, assessmentId: dto.assessmentId },
          status: 'pending',
          createdById: user.userId,
        })
        .returning();

      if (!inserted) {
        throw new Error('No se pudo crear el registro de análisis IA');
      }
      return { analysis: this.toModel(inserted), fromCache: false };
    });
  }

  /** Devuelve un análisis por id dentro del tenant del usuario. */
  async get(user: JwtPayload, id: string): Promise<AiAnalysisModel> {
    const orgId = this.requireOrgId(user);
    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [found] = await tx
        .select()
        .from(aiAnalyses)
        .where(
          and(
            eq(aiAnalyses.id, id),
            eq(aiAnalyses.orgId, orgId),
            isNull(aiAnalyses.deletedAt),
          ),
        )
        .limit(1);
      return found;
    });

    if (!row) {
      throw new NotFoundException('Análisis IA no encontrado');
    }
    return this.toModel(row);
  }

  /** Marca el análisis como `processing` y sella `startedAt` (para el reaper). */
  async markProcessing(id: string, orgId: string): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(aiAnalyses)
        .set({ status: 'processing', startedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(aiAnalyses.id, id), eq(aiAnalyses.orgId, orgId)));
    });
  }

  /** Marca el análisis como `completed` con la salida del modelo en `output`. */
  async markCompleted(
    id: string,
    orgId: string,
    data: MarkCompletedInput,
  ): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(aiAnalyses)
        .set({
          status: 'completed',
          output: data.output,
          model: data.model,
          promptVersion: data.promptVersion,
          tokens: data.tokens,
          costUsd: data.costUsd,
          error: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(aiAnalyses.id, id), eq(aiAnalyses.orgId, orgId)));
    });
  }

  /** Marca el análisis como `failed` con el mensaje de error. */
  async markFailed(id: string, orgId: string, error: string): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(aiAnalyses)
        .set({ status: 'failed', error, completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(aiAnalyses.id, id), eq(aiAnalyses.orgId, orgId)));
    });
  }

  // ---------- helpers ----------

  /**
   * Una fila sirve como caché solo si está `completed`. Una `processing`
   * obsoleta (startedAt más viejo que el umbral) NO es cacheable: deja
   * regenerar. `pending`/`failed` tampoco sirven como caché.
   */
  private isCacheable(row: AiAnalysis): boolean {
    if (row.status === 'completed') {
      return true;
    }
    if (row.status === 'processing') {
      return !this.isStale(row.startedAt);
    }
    return false;
  }

  private isStale(startedAt: Date | null): boolean {
    if (!startedAt) {
      return true;
    }
    const thresholdMs = this.staleMinutes() * 60_000;
    return Date.now() - startedAt.getTime() > thresholdMs;
  }

  private staleMinutes(): number {
    const raw = Number(process.env.AI_ANALYSIS_STALE_MINUTES);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_MINUTES;
  }

  private computeInputHash(input: {
    assessmentId: string;
    analysisType: string;
    audience: string;
    classGroupId: string | null;
    itemId?: string;
  }): string {
    // Orden de claves fijo → hash determinista e independiente del insertion order.
    // `itemId` solo entra al canonical para análisis por-pregunta (H20.8); para los
    // demás tipos el canonical NO cambia (hash de S1 estable).
    const canonical = JSON.stringify({
      assessmentId: input.assessmentId,
      analysisType: input.analysisType,
      audience: input.audience,
      classGroupId: input.classGroupId,
      ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException(
        'Sin organización activa. Selecciona una organización antes de continuar.',
      );
    }
    return user.orgId;
  }

  private toModel(row: AiAnalysis): AiAnalysisModel {
    return {
      id: row.id,
      orgId: row.orgId,
      assessmentId: row.assessmentId,
      analysisType: row.analysisType,
      audience: row.audience,
      status: row.status,
      model: row.model,
      promptVersion: row.promptVersion,
      output: row.output,
      costUsd: row.costUsd,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  }
}
