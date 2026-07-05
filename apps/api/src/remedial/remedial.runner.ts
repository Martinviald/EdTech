import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { items, remedialMaterials, withOrgContext, type RemedialMaterial } from '@soe/db';
import {
  qualityReportSchema,
  type QualityReport,
  type RemedialMaterialType,
  type RemedialStimulus,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { RemedialBriefService, type RemedialBrief } from './remedial-brief.service';
import { RemedialContextService, type RemedialCurriculumContext } from './remedial-context.service';
import { RemedialJudgeService } from './remedial-judge.service';
import { RemedialQualityLoop } from './remedial-quality-loop.service';
import { RemedialService } from './remedial.service';
import {
  REMEDIAL_GENERATORS,
  type RemedialGenerationResult,
  type RemedialGenerator,
  type RemedialJudgeItem,
} from './remedial.generator';
import { StimulusResolver } from './stimulus/stimulus.resolver';

const REMEDIAL_TIMEOUT_MS_DEFAULT = 90_000;

/** Tope de rondas del loop de calidad (ronda 0 + hasta 2 regeneraciones). */
const MAX_QUALITY_ITERATIONS = 3;

// Reintentos ante fallos TRANSITORIOS de red del LLM (ej. "fetch failed" por un reset
// de conexión en el egress). NO reintenta parseo/schema/validación/timeout (esos =
// `failed` directo). Espeja el patrón de ai-analysis.runner.ts (helper privado allá;
// se replica pequeño aquí para no forzar un import cruzado feo). Máx. 2 intentos.
const REMEDIAL_MAX_ATTEMPTS = 2;
const REMEDIAL_RETRY_BACKOFF_MS_DEFAULT = 2_000;

/**
 * Batch del loop de calidad: el resultado del generador de práctica con `judgeItems`
 * garantizado (el loop lo exige). El generador siempre los devuelve para `practice_set`.
 */
type PracticeLoopBatch = RemedialGenerationResult & { judgeItems: RemedialJudgeItem[] };

/**
 * Ejecuta el ciclo real de generación de material remedial (F2 S3 — H9.1–H9.4).
 *
 * Flujo: markProcessing → contexto RAG (CurriculumRetriever) → generador resuelto
 * por `type` → markReady con el `content` validado + trazabilidad. Todo va dentro
 * de try/catch + timeout (`Promise.race`): cualquier error, salida no parseable,
 * schema inválido o timeout deja el material `failed` (nunca tumba el proceso).
 *
 * La IA NUNCA recibe PII: el contexto es curricular (taxonomy) y, para
 * `group_plan`, el generador agrupa de forma determinista en backend y solo pasa
 * agregados. La salida del modelo vive solo en `content`.
 */
@Injectable()
export class RemedialRunner {
  private readonly generators: Map<RemedialMaterialType, RemedialGenerator>;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly service: RemedialService,
    private readonly context: RemedialContextService,
    private readonly brief: RemedialBriefService,
    private readonly stimulus: StimulusResolver,
    private readonly judgeService: RemedialJudgeService,
    private readonly qualityLoop: RemedialQualityLoop,
    @Inject(REMEDIAL_GENERATORS) generators: RemedialGenerator[],
  ) {
    this.generators = new Map(generators.map((g) => [g.type, g]));
  }

  async run(materialId: string, orgId: string): Promise<void> {
    try {
      const record = await this.loadRecord(materialId, orgId);
      if (!record.nodeId) {
        throw new Error('El material no tiene un nodo de taxonomía asociado');
      }

      const generator = this.generators.get(record.type);
      if (!generator) {
        throw new Error(`No hay generador para el tipo "${record.type}"`);
      }

      await this.service.markProcessing(materialId, orgId);

      // Brief del error (G4) + contexto curricular enriquecido (G5) + resolución del
      // estímulo (Ola 2.1a) en paralelo. El brief degrada a `null` si no hay evidencia;
      // `assemble` recibe `orgId` para acotar el pool de ítems. El resolver define el
      // `method` efectivo (puede degradar `reuse_stimulus`→`self_contained` si no hay
      // pasaje) y el estímulo hidratado (o `null`). Si el `stimulusId` del docente no es
      // un pasaje visible, `resolve` lanza NotFoundException → el catch deja `failed`.
      const stimulusId = this.readStimulusId(record.input);
      const [brief, curriculum, resolved] = await Promise.all([
        this.brief.build({
          orgId,
          nodeId: record.nodeId,
          assessmentId: record.assessmentId,
          sourceAnalysisId: record.sourceAnalysisId,
        }),
        this.context.assemble(record.nodeId, orgId),
        this.stimulus.resolve({
          orgId,
          assessmentId: record.assessmentId ?? '',
          nodeId: record.nodeId,
          method: record.method,
          stimulusId,
        }),
      ]);

      // practice_set (Ola 2.1b): juez automático + loop de regeneración (máx 3). El
      // resto de tipos (guide/group_plan) mantiene la generación única sin juez.
      if (record.type === 'practice_set') {
        const { finalBatch, qualityReport } = await this.runQualityLoop(
          generator,
          record,
          orgId,
          curriculum,
          brief,
          resolved.stimulus,
        );
        await this.service.markReady(materialId, orgId, {
          content: finalBatch.content,
          input: { ...finalBatch.audit, brief },
          method: resolved.method,
          model: finalBatch.model,
          promptVersion: finalBatch.promptVersion,
          tokens: finalBatch.tokens,
          costUsd: finalBatch.costUsd,
          // Reporte del juez (converged o exhausted): SIEMPRE queda draft con las objeciones.
          qualityReport: qualityReportSchema.parse(qualityReport),
        });
        return;
      }

      // Retry ante blips de red del LLM (guide/group_plan); el timeout aplica POR
      // intento. Un error de parseo/schema/validación NO es transitorio → falla directo.
      const result = await this.withRetry(() =>
        this.withTimeout(
          generator.generate({
            material: record,
            orgId,
            curriculum,
            brief,
            stimulus: resolved.stimulus,
          }),
          this.timeoutMs(),
        ),
      );

      await this.service.markReady(materialId, orgId, {
        // Auditoría (sin PII): contexto curricular enviado (`result.audit`) + el brief
        // del error usado para anclar la generación. La salida vive solo en `content`.
        content: result.content,
        input: { ...result.audit, brief },
        // Método EFECTIVO resuelto (el generador ya dejó `content.stimuli`).
        method: resolved.method,
        model: result.model,
        promptVersion: result.promptVersion,
        tokens: result.tokens,
        costUsd: result.costUsd,
        qualityReport: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.service.markFailed(materialId, orgId, message);
    }
  }

  // ---------- helpers ----------

  /**
   * Lee el override de pasaje del docente desde `input.stimulusId` (persistido por
   * `RemedialService.create`). `undefined` si no vino → el resolver elige el pasaje de
   * mayor brecha (o cae a self_contained).
   */
  private readStimulusId(input: Record<string, unknown> | null): string | undefined {
    if (input && typeof input === 'object' && 'stimulusId' in input) {
      const value = (input as { stimulusId?: unknown }).stimulusId;
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
  }

  /**
   * Corre el loop de calidad (Ola 2.1b) para un `practice_set`: genera → juzga →
   * regenera TODO el set con las objeciones (máx 3) → converge o `exhausted`.
   *
   * El timeout global (`withTimeout`) envuelve CADA generación y CADA juzgamiento (no
   * el loop completo): así el loop puede correr sus hasta 3 rondas sin que la suma de
   * latencias dispare un timeout espurio, y el modo `exhausted` (que igual persiste el
   * material draft + objeciones) siempre llega a `markReady`. El costo lo acota el
   * cap de 3 rondas (≤3 generaciones + ≤3 juzgamientos), no el reloj.
   */
  private async runQualityLoop(
    generator: RemedialGenerator,
    record: RemedialMaterial,
    orgId: string,
    curriculum: RemedialCurriculumContext,
    brief: RemedialBrief | null,
    stimulus: RemedialStimulus | null,
  ): Promise<{ finalBatch: PracticeLoopBatch; qualityReport: QualityReport }> {
    // Retry (G13) aplicado a CADA operación LLM del loop (generación + juzgamiento):
    // el `withRetry` envuelve el `withTimeout`, así el timeout sigue siendo POR intento
    // y solo los blips de red se reintentan (parseo/schema/timeout NO son transitorios →
    // fallan directo sin gastar el segundo intento). No envuelve el loop completo (que
    // ya acota el costo con el cap de 3 rondas).
    const generate = async (feedback: string[] | undefined): Promise<PracticeLoopBatch> => {
      const result = await this.withRetry(() =>
        this.withTimeout(
          generator.generate({ material: record, orgId, curriculum, brief, stimulus, feedback }),
          this.timeoutMs(),
        ),
      );
      if (!result.judgeItems) {
        throw new Error('El generador de práctica no devolvió ítems para el juez');
      }
      return { ...result, judgeItems: result.judgeItems };
    };

    return this.qualityLoop.run<PracticeLoopBatch>({
      generate,
      judge: (judgeItems) =>
        this.withRetry(() =>
          this.withTimeout(this.judgeService.judge(orgId, stimulus, judgeItems), this.timeoutMs()),
        ),
      softDeletePrevious: (batch) => this.softDeletePreviousItems(batch.judgeItems, orgId),
      maxIter: MAX_QUALITY_ITERATIONS,
    });
  }

  /**
   * Soft-delete (`deletedAt = now()`) de los ítems de una ronda descartada, para que
   * solo sobreviva el set final como draft. Los ítems son del tenant (`org_id`
   * explícito) y `draft` — nunca publicados. Corre en `withOrgContext` (patrón del
   * módulo); `items` se aísla además por filtro `org_id` + `deletedAt IS NULL`.
   */
  private async softDeletePreviousItems(
    judgeItems: RemedialJudgeItem[],
    orgId: string,
  ): Promise<void> {
    const itemIds = judgeItems.map((ji) => ji.itemId);
    if (itemIds.length === 0) return;
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx
        .update(items)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(inArray(items.id, itemIds), eq(items.orgId, orgId), isNull(items.deletedAt)));
    });
  }

  private async loadRecord(materialId: string, orgId: string): Promise<RemedialMaterial> {
    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [found] = await tx
        .select()
        .from(remedialMaterials)
        .where(and(eq(remedialMaterials.id, materialId), eq(remedialMaterials.orgId, orgId)))
        .limit(1);
      return found;
    });
    if (!row) {
      throw new NotFoundException('Material remedial no encontrado');
    }
    return row;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timeout de generación remedial tras ${ms}ms`)),
        ms,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private timeoutMs(): number {
    const raw = Number(process.env.REMEDIAL_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : REMEDIAL_TIMEOUT_MS_DEFAULT;
  }

  /**
   * Reintenta `factory` ante fallos TRANSITORIOS de red (ej. "fetch failed" por un
   * reset de conexión en el egress). NO reintenta parseo/schema/validación/timeout
   * (no son transitorios → `failed` directo). Backoff lineal; override por
   * `REMEDIAL_RETRY_BACKOFF_MS`.
   */
  private async withRetry<T>(factory: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= REMEDIAL_MAX_ATTEMPTS; attempt++) {
      try {
        return await factory();
      } catch (err) {
        lastErr = err;
        if (attempt >= REMEDIAL_MAX_ATTEMPTS || !this.isTransient(err)) {
          throw err;
        }
        await this.delay(this.retryBackoffMs() * attempt);
      }
    }
    throw lastErr;
  }

  /** ¿El error es un fallo de red transitorio (vale la pena reintentar)? */
  private isTransient(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return /fetch failed|econnreset|etimedout|eai_again|socket|network|und_err|terminated|other side closed/.test(
      msg,
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private retryBackoffMs(): number {
    const raw = Number(process.env.REMEDIAL_RETRY_BACKOFF_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : REMEDIAL_RETRY_BACKOFF_MS_DEFAULT;
  }
}
