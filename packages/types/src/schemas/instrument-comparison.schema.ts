import { z } from 'zod';
import { aiAnalysisAudienceSchema } from './ai-analysis.schema';

// ============================================================================
// TKT-23 (Apéndice A) — Diagnóstico IA de la variación entre DOS instrumentos
// comparables (p. ej. el DIA de diagnóstico de dos años). El usuario elige dos
// evaluaciones cuyos instrumentos son comparables (mismo tipo + asignatura +
// grado); el backend ensambla CONTENIDO (enunciados, alternativas, pasajes) +
// RESULTADOS (% de logro por ítem/habilidad, distribución) de ambos y un modelo
// potente PROPONE un diagnóstico de qué explica la variación. Es una HIPÓTESIS
// a validar por el humano, no una verdad determinista (la UI lo advierte).
//
// analysisType persistido = 'instrument_comparison'. Reusa la tabla `ai_analyses`
// (assessmentId = base; input = { baseAssessmentId, comparisonAssessmentId,
// baseInstrumentId, comparisonInstrumentId }; output = ESTE diagnóstico).
// NUNCA contiene PII: el snapshot llega anonimizado (agregados + contenido).
// ============================================================================

/** Constante compartida del tipo de análisis (evita strings mágicos FE/BE). */
export const INSTRUMENT_COMPARISON_ANALYSIS_TYPE = 'instrument_comparison';

// ── Request: gatillar la comparación ─────────────────────────────────────────

/**
 * DTO de `POST /api/ai-analysis/compare-instruments`. Se seleccionan dos
 * evaluaciones (`base` = referencia, típicamente el año/instrumento anterior;
 * `comparison` = el que se contrasta). El backend deriva los instrumentos y
 * valida que sean comparables por datos (mismo tipo/asignatura/grado).
 */
export const compareInstrumentsSchema = z
  .object({
    baseAssessmentId: z.string().uuid(),
    comparisonAssessmentId: z.string().uuid(),
    audience: aiAnalysisAudienceSchema.default('general'),
    force: z.boolean().default(false), // ignora la caché por input_hash
  })
  .refine((v) => v.baseAssessmentId !== v.comparisonAssessmentId, {
    message: 'Selecciona dos evaluaciones distintas para comparar',
    path: ['comparisonAssessmentId'],
  });
export type CompareInstrumentsDto = z.infer<typeof compareInstrumentsSchema>;

/**
 * Query de `GET /api/ai-analysis/compare-instruments/latest` — recupera la última
 * comparación YA EXISTENTE del mismo par (mismo scope que el `inputHash`), sin
 * generar nada. Permite recargar el diagnóstico al re-seleccionar el par.
 */
export const findLatestComparisonQuerySchema = z.object({
  baseAssessmentId: z.string().uuid(),
  comparisonAssessmentId: z.string().uuid(),
  audience: aiAnalysisAudienceSchema.default('general'),
});
export type FindLatestComparisonQuery = z.infer<typeof findLatestComparisonQuerySchema>;

// ── Selector: evaluaciones candidatas para comparar ──────────────────────────

/**
 * Una evaluación candidata para comparar (con metadatos de su instrumento y
 * cobertura). El frontend agrupa por `comparableKey` (tipo|grado|asignatura):
 * solo dos candidatas del MISMO grupo son comparables. `comparableKey` se deriva
 * de datos, NO de strings hardcodeados por instrumento (extensible a SIMCE/PAES).
 */
export const comparableAssessmentSchema = z.object({
  assessmentId: z.string().uuid(),
  assessmentName: z.string().nullable(),
  instrumentId: z.string().uuid(),
  instrumentName: z.string(),
  instrumentType: z.string(),
  year: z.number().int().nullable(),
  gradeId: z.string().uuid().nullable(),
  gradeName: z.string().nullable(),
  subjectId: z.string().uuid().nullable(),
  subjectName: z.string().nullable(),
  studentsEvaluated: z.number().int(),
  administeredAt: z.string().nullable(),
  /** Clave de comparabilidad derivada: `${type}|${gradeId}|${subjectId}`. */
  comparableKey: z.string(),
});
export type ComparableAssessment = z.infer<typeof comparableAssessmentSchema>;

export const comparableAssessmentsResponseSchema = z.object({
  data: z.array(comparableAssessmentSchema),
});
export type ComparableAssessmentsResponse = z.infer<typeof comparableAssessmentsResponseSchema>;

// ============================================================================
// Snapshot DETERMINISTA por lado (input que ensambla el backend, sin PII).
// Reusa el snapshot de evaluación (contenido + psicometría) y lo enriquece con
// alternativas y pasajes para el análisis de contenido.
// ============================================================================

/** Una alternativa de un ítem (contenido, sin PII). */
export type ComparisonAlternative = {
  key: string;
  text: string | null;
  isCorrect: boolean;
};

/** Un ítem del instrumento con su contenido + resultados agregados. */
export type ComparisonItem = {
  position: number;
  skillName: string | null;
  nodeId: string | null;
  stem: string | null; // enunciado (truncado)
  alternatives: ComparisonAlternative[]; // texto truncado
  difficulty: number | null; // p (0..1) — mayor = más fácil
  discrimination: number | null; // D
  correctLabel: string | null;
  dominantDistractor: string | null; // alternativa incorrecta más elegida
  distribution: Record<string, number>; // label -> nº de respuestas
  passageTitle: string | null; // pasaje/sección al que pertenece (si aplica)
};

/** Una habilidad evaluada con su % de logro agregado. */
export type ComparisonSkill = {
  nodeId: string;
  nodeName: string;
  achievement: number | null; // % de logro del grupo (0..100)
  itemCount: number;
};

/** Un pasaje/texto base de una sección (contenido, truncado). */
export type ComparisonPassage = {
  title: string | null;
  excerpt: string | null;
};

/** Un lado de la comparación: un instrumento tal como fue aplicado. */
export type ComparisonSide = {
  assessmentId: string;
  instrumentId: string;
  instrumentName: string | null;
  instrumentType: string | null;
  year: number | null;
  gradeName: string | null;
  subjectName: string | null;
  studentsEvaluated: number;
  studentsEnrolled: number;
  averageAchievement: number | null; // % de logro global (0..100)
  reliabilityKr20: number | null;
  items: ComparisonItem[];
  skills: ComparisonSkill[];
  passages: ComparisonPassage[];
};

export type InstrumentComparisonSnapshot = {
  base: ComparisonSide;
  comparison: ComparisonSide;
};

// ============================================================================
// Salida ESTRUCTURADA del diagnóstico (validada con Zod tras la respuesta del
// modelo). La IA razona sobre el snapshot y devuelve ESTE objeto.
// ============================================================================

export const comparisonDirectionSchema = z.enum(['improved', 'declined', 'stable']);
export type ComparisonDirection = z.infer<typeof comparisonDirectionSchema>;

export const comparisonLikelihoodSchema = z.enum(['high', 'medium', 'low']);
export type ComparisonLikelihood = z.infer<typeof comparisonLikelihoodSchema>;

/** Diferencia detectada en el CONTENIDO entre ambos instrumentos. */
export const comparisonContentDifferenceSchema = z.object({
  aspect: z.string(), // p. ej. "dificultad de los textos", "cobertura de la habilidad X"
  description: z.string(),
  evidence: z.string(), // referencia a ítems/habilidades/pasajes concretos del snapshot
});
export type ComparisonContentDifference = z.infer<typeof comparisonContentDifferenceSchema>;

/** Movimiento de dificultad/logro de una habilidad entre ambos instrumentos. */
export const comparisonSkillMovementSchema = z.object({
  nodeName: z.string(),
  baseAchievement: z.number().nullable(), // % del lado base
  comparisonAchievement: z.number().nullable(), // % del lado comparado
  deltaPct: z.number().nullable(), // comparison - base
  interpretation: z.string(),
});
export type ComparisonSkillMovement = z.infer<typeof comparisonSkillMovementSchema>;

/** Hipótesis de por qué variaron los resultados (el corazón del diagnóstico). */
export const comparisonHypothesisSchema = z.object({
  hypothesis: z.string(),
  supportingEvidence: z.array(z.string()), // señales del snapshot que la sostienen
  relatedSkills: z.array(z.string()), // nodeName de habilidades relacionadas
  likelihood: comparisonLikelihoodSchema,
});
export type ComparisonHypothesis = z.infer<typeof comparisonHypothesisSchema>;

/** Recomendación priorizada y por audiencia. */
export const comparisonRecommendationSchema = z.object({
  audience: z.enum(['director', 'teacher']),
  priority: z.enum(['high', 'medium', 'low']),
  title: z.string(),
  rationale: z.string(),
  suggestedActions: z.array(z.string()),
});
export type ComparisonRecommendation = z.infer<typeof comparisonRecommendationSchema>;

/** Salida completa del diagnóstico de variación entre instrumentos. */
export const instrumentComparisonOutputSchema = z.object({
  headline: z.string(), // titular de una línea: la conclusión principal
  overallVariation: z.object({
    baseAchievement: z.number().nullable(), // % logro global del lado base
    comparisonAchievement: z.number().nullable(), // % logro global del lado comparado
    deltaPct: z.number().nullable(), // comparison - base (puntos porcentuales)
    direction: comparisonDirectionSchema,
    magnitude: z.string(), // lectura cualitativa de la magnitud
  }),
  contentDifferences: z.array(comparisonContentDifferenceSchema), // qué cambió en el contenido/dificultad
  skillMovements: z.array(comparisonSkillMovementSchema), // habilidades que se movieron
  hypotheses: z.array(comparisonHypothesisSchema).min(1), // por qué variaron los resultados
  recommendations: z.array(comparisonRecommendationSchema),
  confidence: z.number().min(0).max(1), // autoevaluación de la solidez del análisis
  caveats: z.array(z.string()), // límites (muestras chicas, poca cobertura, etc.)
});
export type InstrumentComparisonOutput = z.infer<typeof instrumentComparisonOutputSchema>;
