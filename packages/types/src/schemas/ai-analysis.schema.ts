import { z } from 'zod';

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
// causa raíz. `itemQuality` llega en S2.
// ============================================================================

/** Causa probable del bajo desempeño de un ítem (deriva acción distinta). */
export const itemLikelyCauseSchema = z.enum([
  'not_taught', // no enseñado / no alcanzado a ver
  'misconception', // error conceptual (señalado por el distractor dominante)
  'item_quality', // el ítem es defectuoso (baja D, clave ambigua)
  'insufficient_practice', // visto pero poco practicado
]);
export type ItemLikelyCause = z.infer<typeof itemLikelyCauseSchema>;

/** Tarjeta de un ítem de ALTO desempeño: qué replicar. */
export const itemPracticeCardSchema = z.object({
  position: z.number().int(),
  skillName: z.string().nullable(),
  difficulty: z.number().nullable(), // p
  discrimination: z.number().nullable(), // D
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
  reliability: z.object({
    kr20: z.number().nullable(),
    interpretation: z.string(),
  }),
  confidence: z.number().min(0).max(1), // autoevaluación del análisis — H20.7
  caveats: z.array(z.string()), // límites / datos insuficientes — H20.7
});
export type AssessmentInsightsOutput = z.infer<typeof assessmentInsightsOutputSchema>;

// ============================================================================
// AiAnalysisSnapshot — input DETERMINISTA que el backend ensambla (BE-1, H20.1)
// y que el prompt consume (BE-2). Reusa AssessmentReportService (H6.13) + KR-20 /
// punto-biserial / cobertura. NUNCA contiene PII de alumnos (sin nombres ni RUT).
// ============================================================================

export type SnapshotItem = {
  position: number;
  skillName: string | null;
  nodeId: string | null;
  difficulty: number | null; // p (0..1)
  discrimination: number | null; // D (Kelley 27%)
  pointBiserial: number | null; // discriminación fina
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
  reliability: { kr20: number | null };
  items: SnapshotItem[];
  skills: SnapshotSkill[];
};
