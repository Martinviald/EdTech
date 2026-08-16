import { z } from 'zod';
import type { AnswerKey, ScoreCategoryDistribution } from '../utils/answer-key';
import type { RawAnswerCount } from '../utils/raw-answer-distribution';

// Contratos del motor de análisis IA (F2 S0 — H19.23). El output rico por tipo de
// análisis (AssessmentInsightsOutput, etc.) se define en S1; aquí van los DTOs del
// job y el Model de respuesta del registro.

export const aiAnalysisStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);
export type AiAnalysisStatus = z.infer<typeof aiAnalysisStatusSchema>;

export const aiAnalysisAudienceSchema = z.enum(['general', 'director', 'teacher']);
export type AiAnalysisAudience = z.infer<typeof aiAnalysisAudienceSchema>;

export const generateAnalysisSchema = z.object({
  analysisType: z.string().min(1).default('assessment_insights'),
  audience: aiAnalysisAudienceSchema.default('general'),
  classGroupId: z.string().uuid().optional(),
  force: z.boolean().default(false), // ignora la caché por input_hash
});
export type GenerateAnalysisDto = z.infer<typeof generateAnalysisSchema>;

/**
 * Query de `GET /ai-analysis/assessments/:assessmentId/latest` — busca el último
 * análisis YA EXISTENTE para una evaluación (mismo scope que el `inputHash`:
 * analysisType + audience + classGroupId), sin generar nada. Permite que la vista
 * cargue el informe creado previamente al re-seleccionar la evaluación.
 */
export const findLatestAnalysisQuerySchema = z.object({
  analysisType: z.string().min(1).default('assessment_insights'),
  audience: aiAnalysisAudienceSchema.default('general'),
  classGroupId: z.string().uuid().optional(),
});
export type FindLatestAnalysisQuery = z.infer<typeof findLatestAnalysisQuerySchema>;

export type AiAnalysisModel = {
  id: string;
  orgId: string;
  assessmentId: string | null;
  analysisType: string;
  audience: string;
  status: AiAnalysisStatus;
  model: string | null;
  promptVersion: string | null;
  // jsonb genérico (la forma varía por analysisType). Para 'assessment_insights'
  // se valida/parsea con `assessmentInsightsOutputSchema` (abajo).
  output: Record<string, unknown> | null;
  costUsd: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

// ============================================================================
// F2 S1 (E20) — Informe IA de evaluación: contrato de salida estructurada.
// La IA razona sobre métricas deterministas (snapshot) y devuelve ESTE objeto,
// validado con Zod tras la respuesta del modelo. Metodología en 3 capas (§3 de
// la planificación F2): Top/Bottom 5 (entrada concreta) + brechas priorizadas +
// causa raíz. Toda causa es de APRENDIZAJE: la plataforma no juzga la calidad del
// instrumento (docs/diseno-limpieza-calidad-instrumento.md).
// ============================================================================

/**
 * Causa probable del bajo desempeño de un ítem (deriva acción distinta).
 *
 * Las tres son causas de APRENDIZAJE: los instrumentos que procesa la plataforma
 * son estándar y validados, así que un bajo logro nunca se explica por un defecto
 * del ítem. Ver docs/diseno-limpieza-calidad-instrumento.md.
 */
export const itemLikelyCauseSchema = z.enum([
  'not_taught', // no enseñado / no alcanzado a ver
  'misconception', // error conceptual (señalado por el distractor dominante)
  'insufficient_practice', // visto pero poco practicado
]);
export type ItemLikelyCause = z.infer<typeof itemLikelyCauseSchema>;

/** Tarjeta de un ítem de ALTO desempeño: qué replicar. */
export const itemPracticeCardSchema = z.object({
  position: z.number().int(),
  skillName: z.string().nullable(),
  difficulty: z.number().nullable(), // % de logro del ítem, 0..1 (ver D1 del diseño)
  whatWorked: z.array(z.string()), // por qué funcionó (claridad, alineación al OA…)
  replicableAction: z.string(), // práctica reutilizable para clases
});
export type ItemPracticeCard = z.infer<typeof itemPracticeCardSchema>;

/** Tarjeta de un ítem de BAJO desempeño: por qué falló y qué hacer. */
export const itemDiagnosisCardSchema = z.object({
  position: z.number().int(),
  skillName: z.string().nullable(),
  difficulty: z.number().nullable(),
  likelyCause: itemLikelyCauseSchema,
  misconception: z.string().nullable(), // inferida del distractor dominante
  actionPlan: z.array(z.string()).min(1), // pasos concretos de remediación
});
export type ItemDiagnosisCard = z.infer<typeof itemDiagnosisCardSchema>;

/** Diagnóstico de una brecha por habilidad (capa causa raíz). */
export const skillDiagnosisSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  achievement: z.number().nullable(), // % de logro
  rootCauseHypothesis: z.string(),
  misconceptionSignal: z.string().nullable(), // desde patrones de distractor
  reteachStrategy: z.string(),
  exampleActivity: z.string(),
  remedialGroupSize: z.number().int(), // determinista (backend), sin PII
});
export type SkillDiagnosis = z.infer<typeof skillDiagnosisSchema>;

/** Recomendación priorizada y por audiencia (impacto × factibilidad × persistencia). */
export const aiRecommendationSchema = z.object({
  audience: z.enum(['director', 'teacher']),
  priority: z.enum(['high', 'medium', 'low']),
  title: z.string(),
  rationale: z.string(),
  suggestedActions: z.array(z.string()),
  linkedSkillIds: z.array(z.string()),
  linkedItemPositions: z.array(z.number().int()),
});
export type AiRecommendation = z.infer<typeof aiRecommendationSchema>;

/** Salida completa del informe IA de evaluación (analysisType='assessment_insights'). */
export const assessmentInsightsOutputSchema = z.object({
  headline: z.string(),
  executiveSummary: z.object({
    director: z.string(), // foco gestión / priorización
    teacher: z.string(), // foco accionable de aula
  }),
  topItems: z.array(itemPracticeCardSchema), // 5 mejores — H20.3
  bottomItems: z.array(itemDiagnosisCardSchema), // 5 peores — H20.3
  skillGaps: z.array(skillDiagnosisSchema), // brechas con causa raíz — H20.4
  recommendations: z.array(aiRecommendationSchema), // priorizadas — H20.5
  confidence: z.number().min(0).max(1), // autoevaluación del análisis — H20.7
  caveats: z.array(z.string()), // límites / datos insuficientes — H20.7
});
export type AssessmentInsightsOutput = z.infer<typeof assessmentInsightsOutputSchema>;

// ============================================================================
// AiAnalysisSnapshot — input DETERMINISTA que el backend ensambla (BE-1, H20.1)
// y que el prompt consume (BE-2). Reusa AssessmentReportService (H6.13): % de logro
// por ítem, distribución de alternativas y cobertura por habilidad. NUNCA contiene
// PII de alumnos (sin nombres ni RUT).
// ============================================================================

export type SnapshotItem = {
  position: number;
  skillName: string | null;
  nodeId: string | null;
  difficulty: number | null; // % de logro del ítem (0..1)
  correctLabel: string | null; // alternativa correcta
  dominantDistractor: string | null; // alternativa incorrecta más elegida
  distribution: Record<string, number>; // label -> nº de respuestas
  stem: string | null; // enunciado (contenido, sin PII)
};

export type SnapshotSkill = {
  nodeId: string;
  nodeName: string;
  achievement: number | null; // % de logro del grupo
  itemCount: number; // ítems que miden la habilidad
  expectedItemCount: number | null; // cobertura blueprint (esperado vs real)
  studentsBelowThreshold: number; // determinista → alimenta remedialGroupSize
};

export type AiAnalysisSnapshot = {
  assessmentId: string;
  instrumentName: string | null;
  gradeName: string | null;
  subjectName: string | null;
  evaluated: number; // alumnos evaluados
  enrolled: number; // matriculados (cobertura)
  items: SnapshotItem[];
  skills: SnapshotSkill[];
};

// ============================================================================
// F2 S2 (E20) — H20.8: Análisis IA POR-PREGUNTA (drill-down multimodal).
// La IA ingiere el snapshot determinista de UNA pregunta (enunciado, alternativas,
// distribución/distractor dominante, pasaje asociado e imágenes) y explica el
// porqué del resultado. analysisType = 'item_insight'. La salida vive solo en
// `output`; el itemId+assessmentId se guardan en `ai_analyses.input` (no hay
// columna itemId en S2 — extensión futura si se requiere listar por ítem).
// NUNCA PII: el snapshot solo lleva contenido del ítem + agregados.
// ============================================================================

/** DTO para gatillar el análisis IA de una pregunta. POST /api/ai-analysis/items/:itemId/generate */
export const generateItemInsightSchema = z.object({
  assessmentId: z.string().uuid(), // acota la distribución de respuestas (cohorte de la evaluación)
  audience: aiAnalysisAudienceSchema.default('general'),
  classGroupId: z.string().uuid().optional(), // restringe la cohorte a un curso
  force: z.boolean().default(false), // ignora la caché por input_hash
});
export type GenerateItemInsightDto = z.infer<typeof generateItemInsightSchema>;

/** Lectura de un distractor: qué revela elegir esa alternativa. */
export const distractorReadingSchema = z.object({
  key: z.string(), // "A" | "B" | ...
  interpretation: z.string(), // qué misconcepción / error sugiere esta elección
});
export type DistractorReading = z.infer<typeof distractorReadingSchema>;

/** Salida completa del análisis IA por-pregunta (analysisType='item_insight'). */
export const itemInsightOutputSchema = z.object({
  headline: z.string(), // titular del análisis de la pregunta
  performanceSummary: z.string(), // por qué se obtuvo ese resultado (acierto/fallo en su contexto)
  likelyCause: itemLikelyCauseSchema, // reusa el enum de H20.3 (not_taught | misconception | insufficient_practice)
  misconception: z.string().nullable(), // inferida del distractor dominante (null si no aplica)
  distractorAnalysis: z.array(distractorReadingSchema), // lectura de los distractores relevantes
  passageInsight: z.string().nullable(), // cómo el pasaje/material asociado influye (null si la pregunta no tiene pasaje)
  visualInsight: z.string().nullable(), // lectura de la imagen del ítem (null si no se adjuntó imagen)
  recommendedActions: z.array(z.string()).min(1), // acción concreta de remediación o de réplica
  confidence: z.number().min(0).max(1), // autoevaluación del análisis
  caveats: z.array(z.string()), // límites (muestra chica, sin imagen, etc.)
});
export type ItemInsightOutput = z.infer<typeof itemInsightOutputSchema>;

/**
 * Snapshot DETERMINISTA de una pregunta — input que BE-1 ensambla (reusa
 * ItemAnalysisService.getQuestionAnalysis + métricas) y que el prompt consume.
 * Sin PII. `images` solo lleva URLs http(s) fetcheables (best-effort multimodal:
 * si no hay url, se omite la imagen y el análisis sigue en modo texto).
 */
export type ItemInsightSnapshot = {
  itemId: string;
  position: number;
  assessmentId: string;
  instrumentName: string | null;
  type: string; // item_type
  stem: string | null; // enunciado (contenido, sin PII)
  correctKey: string | null;
  alternatives: Array<{
    key: string;
    text: string | null;
    isCorrect: boolean;
    count: number; // nº de alumnos que la eligió
    percentage: number; // 0..100
  }>;
  totalResponses: number;
  blankCount: number;
  correctRate: number | null; // 0..100
  difficulty: number | null; // % de logro del ítem (0..1)
  dominantDistractor: string | null; // alternativa incorrecta más elegida
  skillName: string | null;
  contentName: string | null;
  tags: Array<{ nodeName: string; nodeType: string; nodeCode: string | null }>;
  passage: { title: string | null; text: string | null; format: string | null } | null;
  images: Array<{
    url: string;
    mimeType: string | null;
    note: string | null;
    source: 'item' | 'section';
  }>;
  // Clave/pauta normalizada del ítem (respuesta modelo, respuestas aceptadas,
  // orden correcto, niveles de pauta…). Deja que la IA razone sobre la respuesta
  // esperada en tipos sin alternativas. `undefined` en snapshots antiguos (compat).
  answerKey?: AnswerKey;
  // Distribución por categoría de puntaje (RC/RPC/RI) en ítems de desarrollo;
  // `null` en selección múltiple (ahí la distribución vive en `alternatives`).
  scoreDistribution?: ScoreCategoryDistribution[] | null;
  // Respuestas EXACTAS más frecuentes de los alumnos (respuesta corta/número,
  // ordenar, unir, completar), agregadas y anónimas. Deja que la IA lea el error
  // concreto ("pusieron 24 en vez de 21/10"), no solo el conteo RC/RPC/RI.
  rawAnswerDistribution?: RawAnswerCount[] | null;
};
