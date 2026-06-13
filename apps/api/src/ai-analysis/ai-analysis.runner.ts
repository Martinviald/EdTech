import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { aiAnalyses, withOrgContext, type AiAnalysis } from '@soe/db';
import { and, eq } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.types';
import { LlmService } from '../llm/llm.service';
import { AiAnalysisService } from './ai-analysis.service';

/**
 * Versión del prompt/contrato de salida. Se persiste con el análisis para poder
 * invalidar caché y auditar regresiones cuando el prompt evolucione (el prompt
 * rico de evaluación llega en S1; aquí basta cerrar el ciclo real).
 */
const PROMPT_VERSION = 's0-baseline-v1';

const AI_ANALYSIS_TIMEOUT_MS_DEFAULT = 60_000;

/**
 * Schema mínimo de la salida esperada del modelo en S0. El runner exige un JSON
 * con `summary` (string). Si la salida no parsea → el análisis queda `failed`.
 * El `AssessmentInsightsOutput` rico es de S1.
 */
const baselineOutputSchema = z.object({
  summary: z.string().min(1),
});

@Injectable()
export class AiAnalysisRunner {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly llm: LlmService,
    private readonly service: AiAnalysisService,
  ) {}

  /**
   * Ejecuta el ciclo real del análisis: markProcessing → ensambla prompt
   * mínimo → `LlmService.complete` → parseo Zod del output → markCompleted.
   * Todo envuelto en try/catch + timeout (`Promise.race`): cualquier error,
   * salida no parseable o timeout deja el análisis `failed` (nunca tumba el
   * proceso). NUNCA se envía PII de alumnos al LLM.
   */
  async run(analysisId: string, orgId: string): Promise<void> {
    try {
      const record = await this.loadRecord(analysisId, orgId);
      await this.service.markProcessing(analysisId, orgId);

      const { system, prompt } = this.assemblePrompt(record);

      const raw = await this.withTimeout(
        this.llm.complete(system, prompt, orgId),
        this.timeoutMs(),
      );

      const parsed = this.parseOutput(raw);

      await this.service.markCompleted(analysisId, orgId, {
        output: parsed,
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
   * Ensambla un prompt mínimo de prueba (S0). Solo usa metadatos del análisis
   * (`analysisType`, `audience`) — NUNCA PII de alumnos. El prompt rico (con
   * contexto curricular y resultados) es de S1.
   */
  private assemblePrompt(record: AiAnalysis): { system: string; prompt: string } {
    const system =
      'Eres un asistente pedagógico. Responde EXCLUSIVAMENTE con un objeto JSON ' +
      'válido de la forma {"summary": "<texto>"}. No incluyas texto fuera del JSON.';
    const prompt =
      `Genera un análisis de tipo "${record.analysisType}" para la audiencia ` +
      `"${record.audience}". Devuelve un resumen breve en el campo "summary".`;
    return { system, prompt };
  }

  /**
   * Parsea la salida del modelo a JSON y la valida con el schema baseline.
   * Lanza si no es JSON o no cumple el schema (el caller la convierte en
   * `failed`).
   */
  private parseOutput(raw: string): Record<string, unknown> {
    let json: unknown;
    try {
      json = JSON.parse(this.stripCodeFences(raw));
    } catch {
      throw new Error('La salida del modelo no es JSON válido');
    }
    const result = baselineOutputSchema.safeParse(json);
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
