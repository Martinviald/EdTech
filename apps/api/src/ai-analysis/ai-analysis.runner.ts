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
import { AiAnalysisService } from './ai-analysis.service';
import {
  buildAssessmentInsightsPrompt,
  PROMPT_VERSION,
} from './prompts/assessment-insights.prompt';
import { SNAPSHOT_BUILDER, type SnapshotBuilder } from './snapshot.port';

const AI_ANALYSIS_TIMEOUT_MS_DEFAULT = 60_000;

/**
 * Ejecuta el ciclo real del informe IA de evaluación (F2 S1 — H20.2–H20.5).
 *
 * Flujo: markProcessing → snapshot determinista (puerto SnapshotBuilder) →
 * prompt único (`buildAssessmentInsightsPrompt`) → `LlmService.complete` →
 * parseo Zod ESTRICTO con `assessmentInsightsOutputSchema` → markCompleted.
 *
 * Todo va dentro de try/catch + timeout (`Promise.race`): cualquier error, salida
 * no parseable, schema inválido o timeout deja el análisis `failed` (nunca tumba
 * el proceso). La IA SOLO interpreta el snapshot determinista; NUNCA recibe PII
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

      const raw = await this.withTimeout(
        this.llm.complete(system, prompt, orgId),
        this.timeoutMs(),
      );

      const output = this.parseOutput(raw);

      await this.service.markCompleted(analysisId, orgId, {
        output,
        model: null,
        promptVersion: PROMPT_VERSION,
        tokens: null,
        costUsd: null,
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
      timer = setTimeout(
        () => reject(new Error(`Timeout de análisis IA tras ${ms}ms`)),
        ms,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private timeoutMs(): number {
    const raw = Number(process.env.AI_ANALYSIS_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : AI_ANALYSIS_TIMEOUT_MS_DEFAULT;
  }
}
