import { Injectable, NotFoundException } from '@nestjs/common';
import { aiAnalyses, withOrgContext, type AiAnalysis } from '@soe/db';
import {
  aiAnalysisAudienceSchema,
  instrumentComparisonOutputSchema,
  type AiAnalysisAudience,
  type InstrumentComparisonOutput,
} from '@soe/types';
import { and, eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.types';
import { LlmService } from '../llm/llm.service';
import { estimateLlmCostUsd } from '../llm/llm.pricing';
import { AiAnalysisService } from './ai-analysis.service';
import { InstrumentComparisonSnapshotService } from './instrument-comparison.snapshot';
import {
  buildInstrumentComparisonPrompt,
  PROMPT_VERSION,
} from './prompts/instrument-comparison.prompt';

// El modelo Pro con dos instrumentos completos de contexto puede tardar; alineado
// con el informe de evaluación. Override por env `AI_ANALYSIS_TIMEOUT_MS`.
const TIMEOUT_MS_DEFAULT = 120_000;
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS_DEFAULT = 2_000;

/**
 * Ejecuta el ciclo real del diagnóstico de comparación de instrumentos (TKT-23).
 *
 * Flujo: markProcessing → snapshot determinista de AMBOS instrumentos →
 * prompt único (`buildInstrumentComparisonPrompt`) → `LlmService.completeWithUsage`
 * (feature `instrument_comparison` → modelo potente) → parseo Zod ESTRICTO con
 * `instrumentComparisonOutputSchema` → markCompleted.
 *
 * Todo va dentro de try/catch + timeout + retry ante fallos transitorios de red:
 * cualquier error deja el análisis `failed` (nunca tumba el proceso). La IA SOLO
 * interpreta el snapshot anonimizado; NUNCA recibe PII. Corre async (no bloquea
 * el event loop transaccional): lo despacha el `JOB_DISPATCHER`.
 */
@Injectable()
export class InstrumentComparisonRunner {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly llm: LlmService,
    private readonly service: AiAnalysisService,
    private readonly snapshot: InstrumentComparisonSnapshotService,
  ) {}

  async run(analysisId: string, orgId: string): Promise<void> {
    try {
      const record = await this.loadRecord(analysisId, orgId);
      const { baseAssessmentId, comparisonAssessmentId } = this.readInput(record);

      await this.service.markProcessing(analysisId, orgId);

      const snapshot = await this.snapshot.build(baseAssessmentId, comparisonAssessmentId, orgId);

      const audience = this.resolveAudience(record.audience);
      const { system, prompt } = buildInstrumentComparisonPrompt(snapshot, audience);

      const completion = await this.withRetry(() =>
        this.withTimeout(
          this.llm.completeWithUsage(system, prompt, orgId, 'instrument_comparison'),
          this.timeoutMs(),
        ),
      );

      const output = this.parseOutput(completion.text);

      await this.service.markCompleted(analysisId, orgId, {
        output,
        model: completion.model,
        promptVersion: PROMPT_VERSION,
        tokens: completion.usage
          ? { input: completion.usage.inputTokens, output: completion.usage.outputTokens }
          : null,
        costUsd: estimateLlmCostUsd(completion.model, completion.usage),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.service.markFailed(analysisId, orgId, message);
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────

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

  /** Lee los dos assessmentId persistidos en `ai_analyses.input`. */
  private readInput(record: AiAnalysis): {
    baseAssessmentId: string;
    comparisonAssessmentId: string;
  } {
    const input = record.input ?? {};
    const base = input['baseAssessmentId'];
    const comparison = input['comparisonAssessmentId'];
    if (typeof base !== 'string' || typeof comparison !== 'string') {
      throw new Error('La comparación no tiene las evaluaciones asociadas en input');
    }
    return { baseAssessmentId: base, comparisonAssessmentId: comparison };
  }

  private resolveAudience(audience: string): AiAnalysisAudience {
    const parsed = aiAnalysisAudienceSchema.safeParse(audience);
    return parsed.success ? parsed.data : 'general';
  }

  private parseOutput(raw: string): InstrumentComparisonOutput {
    let json: unknown;
    try {
      json = JSON.parse(this.stripCodeFences(raw));
    } catch {
      throw new Error('La salida del modelo no es JSON válido');
    }
    const result = instrumentComparisonOutputSchema.safeParse(json);
    if (!result.success) {
      throw new Error(`La salida del modelo no cumple el schema: ${result.error.message}`);
    }
    return result.data;
  }

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
    return Number.isFinite(raw) && raw > 0 ? raw : TIMEOUT_MS_DEFAULT;
  }

  private async withRetry<T>(factory: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await factory();
      } catch (err) {
        lastErr = err;
        if (attempt >= MAX_ATTEMPTS || !this.isTransient(err)) {
          throw err;
        }
        await this.delay(this.retryBackoffMs() * attempt);
      }
    }
    throw lastErr;
  }

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
    return Number.isFinite(raw) && raw >= 0 ? raw : RETRY_BACKOFF_MS_DEFAULT;
  }
}
