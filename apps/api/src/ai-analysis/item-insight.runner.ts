import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { aiAnalyses, withOrgContext, type AiAnalysis } from '@soe/db';
import {
  aiAnalysisAudienceSchema,
  itemInsightOutputSchema,
  type AiAnalysisAudience,
  type ItemInsightOutput,
  type UserRole,
} from '@soe/types';
import { and, eq } from 'drizzle-orm';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { LlmService } from '../llm/llm.service';
import { AiAnalysisService } from './ai-analysis.service';
import {
  buildItemInsightPrompt,
  ITEM_INSIGHT_PROMPT_VERSION,
} from './prompts/item-insight.prompt';
import {
  ITEM_INSIGHT_BUILDER,
  type ItemInsightBuilder,
} from './item-insight.port';

const ITEM_INSIGHT_TIMEOUT_MS_DEFAULT = 60_000;

/**
 * Ejecuta el ciclo del análisis IA POR-PREGUNTA (F2 S2 — H20.8).
 *
 * Flujo: markProcessing → leer itemId/assessmentId desde `ai_analyses.input` →
 * snapshot determinista por-pregunta (puerto ItemInsightBuilder) + imágenes base64
 * → prompt → `LlmService.completeMultimodal` (degrada a texto si no hay imágenes o
 * el provider no soporta multimodal) → parseo Zod ESTRICTO con
 * `itemInsightOutputSchema` (tolera fences) → markCompleted.
 *
 * Todo va dentro de try/catch + timeout (`Promise.race`): cualquier error, salida
 * no parseable, schema inválido o timeout deja el análisis `failed` (nunca tumba el
 * proceso). La IA SOLO interpreta el snapshot determinista; NUNCA recibe PII. La
 * salida del modelo vive solo en `output`.
 */
@Injectable()
export class ItemInsightRunner {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly llm: LlmService,
    private readonly service: AiAnalysisService,
    @Inject(ITEM_INSIGHT_BUILDER) private readonly snapshot: ItemInsightBuilder,
  ) {}

  async run(analysisId: string, orgId: string): Promise<void> {
    try {
      const record = await this.loadRecord(analysisId, orgId);
      const { itemId, assessmentId } = this.readInput(record);

      await this.service.markProcessing(analysisId, orgId);

      const { snapshot, images } = await this.snapshot.build(
        this.orgScopedUser(orgId),
        itemId,
        {
          assessmentId,
          classGroupId: record.classGroupId ?? undefined,
        },
      );

      const audience = this.resolveAudience(record.audience);
      const { system, prompt } = buildItemInsightPrompt(snapshot, audience);

      const raw = await this.withTimeout(
        this.llm.completeMultimodal(system, prompt, images, orgId),
        this.timeoutMs(),
      );

      const output = this.parseOutput(raw);

      await this.service.markCompleted(analysisId, orgId, {
        output,
        model: null,
        promptVersion: ITEM_INSIGHT_PROMPT_VERSION,
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
   * Lee `itemId` y `assessmentId` desde el jsonb `input` (persistido en
   * `createForItem`). Cae a `assessmentId` de la columna si no estuviera en input.
   */
  private readInput(record: AiAnalysis): { itemId: string; assessmentId: string } {
    const input = (record.input ?? {}) as {
      itemId?: unknown;
      assessmentId?: unknown;
    };
    const itemId = typeof input.itemId === 'string' ? input.itemId : null;
    const assessmentId =
      typeof input.assessmentId === 'string'
        ? input.assessmentId
        : record.assessmentId;
    if (!itemId) {
      throw new Error('El análisis por-pregunta no tiene itemId en input');
    }
    if (!assessmentId) {
      throw new Error('El análisis no tiene una evaluación asociada');
    }
    return { itemId, assessmentId };
  }

  /**
   * Normaliza la audiencia persistida (text libre en DB) al enum del contrato.
   * Si no es una audiencia conocida, cae a `general`.
   */
  private resolveAudience(audience: string): AiAnalysisAudience {
    const parsed = aiAnalysisAudienceSchema.safeParse(audience);
    return parsed.success ? parsed.data : 'general';
  }

  /**
   * Parsea la salida del modelo a JSON (tolerando fences ```json) y la valida con
   * el schema ESTRICTO del análisis por-pregunta. Lanza si no es JSON o no cumple
   * el contrato (el caller la convierte en `failed`).
   */
  private parseOutput(raw: string): ItemInsightOutput {
    let json: unknown;
    try {
      json = JSON.parse(this.stripCodeFences(raw));
    } catch {
      throw new Error('La salida del modelo no es JSON válido');
    }
    const result = itemInsightOutputSchema.safeParse(json);
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
    return Number.isFinite(raw) && raw > 0 ? raw : ITEM_INSIGHT_TIMEOUT_MS_DEFAULT;
  }

  /**
   * Usuario sintético admin-like ligado al `orgId` del token (mismo patrón que el
   * snapshot de S1). El job corre async sin request; el snapshot por-pregunta es
   * una vista org-wide determinista. El `orgId` NUNCA viene del body — lo pasa el
   * controller desde el JWT al encolar.
   */
  private orgScopedUser(orgId: string): JwtPayload {
    const role: UserRole = 'academic_director';
    return {
      userId: 'item-insight-runner',
      orgId,
      email: 'item-insight@internal',
      name: 'Item Insight Runner',
      isPlatformAdmin: false,
      roles: [role],
      activeRole: role,
      role,
    };
  }
}
