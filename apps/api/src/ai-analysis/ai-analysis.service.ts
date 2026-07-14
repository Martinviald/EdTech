import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  aiAnalyses,
  assessmentResults,
  assessments,
  grades,
  instruments,
  subjects,
  withOrgContext,
  type AiAnalysis,
} from '@soe/db';
import {
  INSTRUMENT_COMPARISON_ANALYSIS_TYPE,
  type AiAnalysisModel,
  type ComparableAssessment,
  type CompareInstrumentsDto,
  type GenerateAnalysisDto,
  type GenerateItemInsightDto,
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

  /**
   * Devuelve el ÚLTIMO análisis ya existente para una evaluación con el mismo
   * scope que usa la caché (`assessmentId + analysisType + audience + classGroupId`),
   * o `null` si no hay ninguno. NO genera ni inserta nada: permite que la vista
   * cargue el informe creado previamente al re-seleccionar la evaluación. Devuelve
   * la fila más reciente sin importar su estado — la UI maneja
   * pending/processing/failed/completed.
   */
  async findLatestForAssessment(
    user: JwtPayload,
    params: {
      assessmentId: string;
      analysisType: string;
      audience: string;
      classGroupId: string | null;
    },
  ): Promise<AiAnalysisModel | null> {
    const orgId = this.requireOrgId(user);
    const inputHash = this.computeInputHash({
      assessmentId: params.assessmentId,
      analysisType: params.analysisType,
      audience: params.audience,
      classGroupId: params.classGroupId,
    });

    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [found] = await tx
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
      return found;
    });

    return row ? this.toModel(row) : null;
  }

  /** Devuelve un análisis por id dentro del tenant del usuario. */
  async get(user: JwtPayload, id: string): Promise<AiAnalysisModel> {
    const orgId = this.requireOrgId(user);
    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [found] = await tx
        .select()
        .from(aiAnalyses)
        .where(
          and(eq(aiAnalyses.id, id), eq(aiAnalyses.orgId, orgId), isNull(aiAnalyses.deletedAt)),
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
  async markCompleted(id: string, orgId: string, data: MarkCompletedInput): Promise<void> {
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

  // ============================================================================
  // TKT-23 — Comparación de instrumentos comparables (diagnóstico IA)
  // ============================================================================

  /**
   * Crea (o reutiliza desde caché) una comparación entre dos instrumentos
   * comparables. Valida por DATOS que ambos instrumentos sean comparables (mismo
   * tipo + asignatura + grado y distintos), resuelve sus instrumentos y persiste
   * los dos assessmentId en `input`. `analysisType` = 'instrument_comparison',
   * `assessmentId` = base (para el índice/cascade). El `orgId` viene del token.
   */
  async createComparison(
    user: JwtPayload,
    dto: CompareInstrumentsDto,
  ): Promise<CreateAnalysisResult> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const [base, comparison] = await Promise.all([
        this.loadComparableInstrument(tx, orgId, dto.baseAssessmentId),
        this.loadComparableInstrument(tx, orgId, dto.comparisonAssessmentId),
      ]);

      this.assertComparable(base, comparison);

      const inputHash = this.computeComparisonHash({
        baseAssessmentId: dto.baseAssessmentId,
        comparisonAssessmentId: dto.comparisonAssessmentId,
        audience: dto.audience,
      });

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
          assessmentId: dto.baseAssessmentId,
          analysisType: INSTRUMENT_COMPARISON_ANALYSIS_TYPE,
          audience: dto.audience,
          inputHash,
          input: {
            baseAssessmentId: dto.baseAssessmentId,
            comparisonAssessmentId: dto.comparisonAssessmentId,
            baseInstrumentId: base.instrumentId,
            comparisonInstrumentId: comparison.instrumentId,
          },
          status: 'pending',
          createdById: user.userId,
        })
        .returning();

      if (!inserted) {
        throw new Error('No se pudo crear el registro de comparación IA');
      }
      return { analysis: this.toModel(inserted), fromCache: false };
    });
  }

  /**
   * Devuelve la ÚLTIMA comparación YA EXISTENTE para un par de evaluaciones con el
   * mismo scope de caché (par ordenado + audiencia), o `null`. No genera nada.
   */
  async findLatestComparison(
    user: JwtPayload,
    params: {
      baseAssessmentId: string;
      comparisonAssessmentId: string;
      audience: string;
    },
  ): Promise<AiAnalysisModel | null> {
    const orgId = this.requireOrgId(user);
    const inputHash = this.computeComparisonHash(params);

    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [found] = await tx
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
      return found;
    });

    return row ? this.toModel(row) : null;
  }

  /**
   * Lista las evaluaciones de la org que YA tienen resultados, con metadatos de su
   * instrumento (tipo, año, grado, asignatura) y cobertura. El frontend agrupa por
   * `comparableKey` (tipo|grado|asignatura, derivado de datos, NO hardcodeado): solo
   * dos candidatas del mismo grupo son comparables. Vista org-wide (roles de
   * generación de análisis IA).
   */
  async listComparableAssessments(user: JwtPayload): Promise<ComparableAssessment[]> {
    const orgId = this.requireOrgId(user);

    const rows = await withOrgContext(this.db, orgId, async (tx) => {
      return tx
        .select({
          assessmentId: assessments.id,
          assessmentName: assessments.name,
          administeredAt: assessments.administeredAt,
          instrumentId: instruments.id,
          instrumentName: instruments.name,
          instrumentType: sql<string>`${instruments.type}::text`,
          year: instruments.year,
          gradeId: instruments.gradeId,
          gradeName: grades.name,
          subjectId: instruments.subjectId,
          subjectName: subjects.name,
          studentsEvaluated: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
        })
        .from(assessments)
        .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
        .innerJoin(assessmentResults, eq(assessmentResults.assessmentId, assessments.id))
        .leftJoin(grades, eq(grades.id, instruments.gradeId))
        .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
        .where(eq(assessments.orgId, orgId))
        .groupBy(
          assessments.id,
          assessments.name,
          assessments.administeredAt,
          instruments.id,
          instruments.name,
          instruments.type,
          instruments.year,
          instruments.gradeId,
          grades.name,
          instruments.subjectId,
          subjects.name,
        )
        .orderBy(desc(assessments.administeredAt));
    });

    return rows.map((r) => ({
      assessmentId: r.assessmentId,
      assessmentName: r.assessmentName,
      instrumentId: r.instrumentId,
      instrumentName: r.instrumentName,
      instrumentType: r.instrumentType,
      year: r.year,
      gradeId: r.gradeId,
      gradeName: r.gradeName,
      subjectId: r.subjectId,
      subjectName: r.subjectName,
      studentsEvaluated: Number(r.studentsEvaluated),
      administeredAt: r.administeredAt ? r.administeredAt.toISOString() : null,
      comparableKey: comparableKey(r.instrumentType, r.gradeId, r.subjectId),
    }));
  }

  /** Carga los datos de comparabilidad del instrumento aplicado por un assessment. */
  private async loadComparableInstrument(
    tx: Database,
    orgId: string,
    assessmentId: string,
  ): Promise<ComparableInstrument> {
    const [row] = await tx
      .select({
        instrumentId: instruments.id,
        type: sql<string>`${instruments.type}::text`,
        gradeId: instruments.gradeId,
        subjectId: instruments.subjectId,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(and(eq(assessments.id, assessmentId), eq(assessments.orgId, orgId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException(`Evaluación ${assessmentId} no encontrada`);
    }
    return {
      instrumentId: row.instrumentId,
      type: row.type,
      gradeId: row.gradeId,
      subjectId: row.subjectId,
    };
  }

  /**
   * Comparabilidad por DATOS: mismo tipo de instrumento + mismo grado + misma
   * asignatura, y distintos instrumentos. No hay strings hardcodeados ("DIA", etc.):
   * la regla se deriva de `type/gradeId/subjectId`, extensible a SIMCE/PAES/Cambridge.
   */
  private assertComparable(a: ComparableInstrument, b: ComparableInstrument): void {
    if (a.instrumentId === b.instrumentId) {
      throw new BadRequestException(
        'Las dos evaluaciones usan el mismo instrumento; selecciona instrumentos distintos.',
      );
    }
    if (a.type !== b.type || a.gradeId !== b.gradeId || a.subjectId !== b.subjectId) {
      throw new BadRequestException(
        'Los instrumentos no son comparables: deben ser del mismo tipo, grado y asignatura.',
      );
    }
  }

  /**
   * Hash determinista del scope de una comparación. El orden base→comparación
   * importa (determina la dirección del diagnóstico), así que NO se ordena el par.
   */
  private computeComparisonHash(input: {
    baseAssessmentId: string;
    comparisonAssessmentId: string;
    audience: string;
  }): string {
    const canonical = JSON.stringify({
      analysisType: INSTRUMENT_COMPARISON_ANALYSIS_TYPE,
      audience: input.audience,
      baseAssessmentId: input.baseAssessmentId,
      comparisonAssessmentId: input.comparisonAssessmentId,
    });
    return createHash('sha256').update(canonical).digest('hex');
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

/** Datos mínimos de un instrumento para decidir comparabilidad (TKT-23). */
interface ComparableInstrument {
  instrumentId: string;
  type: string;
  gradeId: string | null;
  subjectId: string | null;
}

/**
 * Clave de comparabilidad derivada de datos: `tipo|grado|asignatura`. Dos
 * evaluaciones son comparables sii comparten esta clave. No hardcodea instrumentos.
 */
function comparableKey(type: string, gradeId: string | null, subjectId: string | null): string {
  return `${type}|${gradeId ?? ''}|${subjectId ?? ''}`;
}
