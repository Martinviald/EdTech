import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { aiAnalyses, withOrgContext } from '@soe/db';
import { assessmentInsightsOutputSchema } from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

/**
 * Un error REALMENTE observado sobre el nodo objetivo (evidencia del diagnóstico).
 * Se deriva del snapshot determinista del análisis IA (PII-free por construcción).
 */
export interface RemedialBriefRealError {
  stem: string | null; // enunciado del ítem (contenido, sin PII)
  correctLabel: string | null; // alternativa correcta
  dominantDistractor: string | null; // alternativa incorrecta más elegida (la evidencia clave)
  distribution: Record<string, number>; // label -> nº de respuestas
}

/**
 * Brief diagnóstico PII-free que ancla la generación remedial a la evidencia del
 * error (G4). Interface backend-interna (NO en `packages/types`): se ensambla desde
 * el análisis IA de origen y se persiste en `remedial_materials.input` para auditoría.
 */
export interface RemedialBrief {
  rootCauseHypothesis: string | null; // output.skillGaps[nodeId].rootCauseHypothesis
  misconceptionSignal: string | null; // idem .misconceptionSignal
  reteachStrategy: string | null; // idem .reteachStrategy
  achievement: number | null; // % de logro del grupo en la habilidad
  realErrors: RemedialBriefRealError[]; // distractores realmente elegidos (evidencia)
}

/** Entrada de `build`: identifica el nodo y el análisis IA del que se lee la evidencia. */
export interface RemedialBriefInput {
  orgId: string;
  nodeId: string;
  assessmentId?: string | null;
  sourceAnalysisId?: string | null;
}

/**
 * Subconjunto del `AiAnalysisSnapshot` (`@soe/types`) que necesita el brief. El
 * snapshot vive como JSONB en `ai_analyses.input`; al ser un límite de confianza se
 * parsea de forma defensiva con Zod (no existe schema runtime del snapshot completo,
 * es un `type`). Zod descarta las claves extra: solo validamos lo que usamos.
 */
const briefSnapshotItemSchema = z.object({
  nodeId: z.string().nullable(),
  stem: z.string().nullable(),
  correctLabel: z.string().nullable(),
  dominantDistractor: z.string().nullable(),
  distribution: z.record(z.string(), z.number()),
});

const briefSnapshotSchema = z.object({
  items: z.array(briefSnapshotItemSchema),
});

/**
 * Ensamblador del brief diagnóstico (Ola 1 remedial · G4). Responsabilidad única:
 * leer el análisis IA de origen y destilar la causa raíz + la evidencia del error
 * del nodo objetivo, SIN llamar al LLM y SIN PII.
 *
 * Fuente de verdad: la fila `ai_analyses` (bajo RLS → `withOrgContext` + `tx`). Se
 * reusa lo ya almacenado (no se recalcula): `output` (informe estructurado) para la
 * causa raíz, `input` (snapshot determinista) para los distractores reales.
 *
 * Degradación elegante: cualquier condición que impida armar el brief devuelve
 * `null` (nunca lanza). La generación sigue con el contexto curricular.
 */
@Injectable()
export class RemedialBriefService {
  private readonly logger = new Logger(RemedialBriefService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  async build(input: RemedialBriefInput): Promise<RemedialBrief | null> {
    const { orgId, nodeId, sourceAnalysisId } = input;

    // Sin análisis de origen no hay evidencia que anclar → generación solo curricular.
    if (!sourceAnalysisId) {
      this.logger.debug(
        `Brief omitido: sin sourceAnalysisId (nodeId=${nodeId}). Generación solo curricular.`,
      );
      return null;
    }

    // `ai_analyses` está bajo RLS → leer dentro de withOrgContext con `tx`. El filtro
    // org_id explícito refuerza el aislamiento (defensa en profundidad).
    const row = await withOrgContext(this.db, orgId, async (tx) => {
      const [found] = await tx
        .select({ input: aiAnalyses.input, output: aiAnalyses.output })
        .from(aiAnalyses)
        .where(
          and(
            eq(aiAnalyses.id, sourceAnalysisId),
            eq(aiAnalyses.orgId, orgId),
            isNull(aiAnalyses.deletedAt),
          ),
        )
        .limit(1);
      return found;
    });

    if (!row) {
      this.logger.warn(
        `Brief omitido: análisis ${sourceAnalysisId} no encontrado en org ${orgId}.`,
      );
      return null;
    }

    // output → informe estructurado (causa raíz por brecha).
    const parsedOutput = assessmentInsightsOutputSchema.safeParse(row.output);
    if (!parsedOutput.success) {
      this.logger.warn(
        `Brief omitido: el output del análisis ${sourceAnalysisId} no parsea como assessment_insights.`,
      );
      return null;
    }

    const gap = parsedOutput.data.skillGaps.find((g) => g.nodeId === nodeId);
    if (!gap) {
      this.logger.warn(
        `Brief omitido: el nodo ${nodeId} no figura en skillGaps del análisis ${sourceAnalysisId}.`,
      );
      return null;
    }

    // input → snapshot determinista (evidencia de distractores reales).
    const parsedSnapshot = briefSnapshotSchema.safeParse(row.input);
    if (!parsedSnapshot.success) {
      this.logger.warn(
        `Brief omitido: el input (snapshot) del análisis ${sourceAnalysisId} no parsea.`,
      );
      return null;
    }

    const realErrors: RemedialBriefRealError[] = parsedSnapshot.data.items
      .filter((item) => item.nodeId === nodeId)
      .map((item) => ({
        stem: item.stem,
        correctLabel: item.correctLabel,
        dominantDistractor: item.dominantDistractor,
        distribution: item.distribution,
      }));

    return {
      rootCauseHypothesis: gap.rootCauseHypothesis,
      misconceptionSignal: gap.misconceptionSignal,
      reteachStrategy: gap.reteachStrategy,
      achievement: gap.achievement,
      realErrors,
    };
  }
}
