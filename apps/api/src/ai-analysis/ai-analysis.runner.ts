import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { aiAnalyses, withOrgContext, type AiAnalysis } from '@soe/db';
import {
  aiAnalysisAudienceSchema,
  assessmentInsightsOutputSchema,
  type AiAnalysisAudience,
  type AssessmentInsightsOutput,
} from '@soe/types';
import { and, eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.types';
import { LlmService } from '../llm/llm.service';
import { estimateLlmCostUsd } from '../llm/llm.pricing';
import { AiAnalysisService } from './ai-analysis.service';
import {
  buildAssessmentInsightsPrompt,
  PROMPT_VERSION,
} from './prompts/assessment-insights.prompt';
import { SNAPSHOT_BUILDER, type SnapshotBuilder } from './snapshot.port';

// 120s: el modelo Pro (tarea `analysis`) con thinking obligatorio tarda más que
// Flash — un informe extenso midió ~90s. Override por env `AI_ANALYSIS_TIMEOUT_MS`.
const AI_ANALYSIS_TIMEOUT_MS_DEFAULT = 120_000;

// Reintentos ante fallos TRANSITORIOS de red del LLM (ej. "fetch failed" por un
// reset de conexión en el egress). NO reintenta parseo/schema/timeout. El provider
// Gemini ya mitiga el idle-timeout usando streaming; esto cubre el blip residual.
const AI_ANALYSIS_MAX_ATTEMPTS = 2;
const AI_ANALYSIS_RETRY_BACKOFF_MS_DEFAULT = 2_000;

/**
 * Ejecuta el ciclo real del informe IA de evaluación (F2 S1 — H20.2–H20.5).
 *
 * Flujo: markProcessing → snapshot determinista (puerto SnapshotBuilder) →
 * prompt único (`buildAssessmentInsightsPrompt`) → `LlmService.complete` →
 * parseo Zod ESTRICTO con `assessmentInsightsOutputSchema` → markCompleted.
 *
 * Todo va dentro de try/catch + timeout (`Promise.race`) + retry ante fallos
 * transitorios de red del LLM: cualquier error, salida no parseable, schema
 * inválido o timeout deja el análisis `failed` (nunca tumba el proceso). El
 * provider Gemini hace la llamada por streaming (conexión no-idle) para no chocar
 * con el idle-timeout de egress. La IA SOLO interpreta el snapshot determinista;
 * NUNCA recibe PII
 * (el snapshot ya viene anonimizado). La salida del modelo vive solo en `output`.
 */
@Injectable()
export class AiAnalysisRunner {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly llm: LlmService,
    private readonly service: AiAnalysisService,
    @Inject(SNAPSHOT_BUILDER) private readonly snapshot: SnapshotBuilder,
  ) {}

  async run(analysisId: string, orgId: string): Promise<void> {
    try {
      const record = await this.loadRecord(analysisId, orgId);
      if (!record.assessmentId) {
        throw new Error('El análisis no tiene una evaluación asociada');
      }

      await this.service.markProcessing(analysisId, orgId);

      const snapshot = await this.snapshot.build(record.assessmentId, orgId, {
        classGroupId: record.classGroupId ?? undefined,
      });

      const audience = this.resolveAudience(record.audience);
      const { system, prompt } = buildAssessmentInsightsPrompt(snapshot, audience);

      const completion = await this.withRetry(() =>
        this.withTimeout(
          this.llm.completeWithUsage(system, prompt, orgId, 'assessment_analysis'),
          this.timeoutMs(),
        ),
      );

      const output = this.parseOutput(completion.text);

      await this.service.markCompleted(analysisId, orgId, {
        output,
        model: completion.model,
        promptVersion: PROMPT_VERSION,
        tokens: completion.usage
          ? {
              input: completion.usage.inputTokens,
              output: completion.usage.outputTokens,
            }
          : null,
        costUsd: estimateLlmCostUsd(completion.model, completion.usage),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.service.markFailed(analysisId, orgId, message);
    }
  }

  // ---------- helpers ----------

  private async loadRecord(analysisId: string, orgId: string): Promise<AiAnalysis> {
    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [found] = await tx
        .select()
        .from(aiAnalyses)
        .where(and(eq(aiAnalyses.id, analysisId), eq(aiAnalyses.orgId, orgId)))
        .limit(1);
      return found;
    });
    if (!row) {
      throw new NotFoundException('Análisis IA no encontrado');
    }
    return row;
  }

  /**
   * Normaliza la audiencia persistida (text libre en DB) al enum del contrato.
   * Si no es una audiencia conocida, cae a `general` (defensa: no debe romper el
   * informe por un valor histórico inesperado).
   */
  private resolveAudience(audience: string): AiAnalysisAudience {
    const parsed = aiAnalysisAudienceSchema.safeParse(audience);
    return parsed.success ? parsed.data : 'general';
  }

  /**
   * Parsea la salida del modelo a JSON (tolerando fences ```json) y la valida con
   * el schema ESTRICTO del informe. Lanza si no es JSON o no cumple el contrato
   * (el caller la convierte en `failed`).
   */
  private parseOutput(raw: string): AssessmentInsightsOutput {
    let json: unknown;
    try {
      json = JSON.parse(this.stripCodeFences(raw));
    } catch {
      throw new Error('La salida del modelo no es JSON válido');
    }
    const result = assessmentInsightsOutputSchema.safeParse(json);
    if (!result.success) {
      throw new Error(`La salida del modelo no cumple el schema: ${result.error.message}`);
    }
    return result.data;
  }

  /** Quita fences ```json … ``` que algunos modelos añaden alrededor del JSON. */
  private stripCodeFences(raw: string): string {
    const trimmed = raw.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return fenced?.[1] ?? trimmed;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout de análisis IA tras ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private timeoutMs(): number {
    const raw = Number(process.env.AI_ANALYSIS_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : AI_ANALYSIS_TIMEOUT_MS_DEFAULT;
  }

  /**
   * Reintenta `factory` ante fallos TRANSITORIOS de red (ej. "fetch failed" por un
   * reset de conexión en el egress). NO reintenta errores de parseo/schema/timeout
   * (no son transitorios). Backoff lineal; override por `AI_ANALYSIS_RETRY_BACKOFF_MS`.
   */
  private async withRetry<T>(factory: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= AI_ANALYSIS_MAX_ATTEMPTS; attempt++) {
      try {
        return await factory();
      } catch (err) {
        lastErr = err;
        if (attempt >= AI_ANALYSIS_MAX_ATTEMPTS || !this.isTransient(err)) {
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
    const raw = Number(process.env.AI_ANALYSIS_RETRY_BACKOFF_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : AI_ANALYSIS_RETRY_BACKOFF_MS_DEFAULT;
  }
}
