import { z } from 'zod';
import type { InstrumentApplicationPeriod } from './instrument.schema';
import type { PerformanceBandView } from './performance-band.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Comparación de dos evaluaciones SIN IA (docs/diseno/rediseno-navegacion.md §3).
//
// GET /assessment-comparisons?baseAssessmentId=&comparisonAssessmentId=&cohort=
// GET /assessment-comparisons/candidates?baseAssessmentId=
//
// Dos evaluaciones son comparables si sus instrumentos cumplen
// `areInstrumentsComparable` (comparability.ts). La comparación NO promedia
// porcentajes: el % de logro de cada lado es `achievementPct` sobre tallies
// (Σpuntaje/Σmáximo), y los niveles salen de las bandas de CADA instrumento.
// ─────────────────────────────────────────────────────────────────────────────

export const ASSESSMENT_COMPARISON_COHORTS = ['paired', 'all'] as const;
export const assessmentComparisonCohortSchema = z.enum(ASSESSMENT_COMPARISON_COHORTS);
export type AssessmentComparisonCohort = z.infer<typeof assessmentComparisonCohortSchema>;

export const assessmentComparisonQuerySchema = z
  .object({
    baseAssessmentId: z.string().uuid(),
    comparisonAssessmentId: z.string().uuid(),
    // `paired` = sólo los estudiantes que rindieron ambas; `all` = cada cohorte completa.
    cohort: assessmentComparisonCohortSchema.default('paired'),
  })
  .strict();
export type AssessmentComparisonQueryDto = z.infer<typeof assessmentComparisonQuerySchema>;

export const assessmentComparisonCandidatesQuerySchema = z
  .object({
    baseAssessmentId: z.string().uuid(),
  })
  .strict();
export type AssessmentComparisonCandidatesQueryDto = z.infer<
  typeof assessmentComparisonCandidatesQuerySchema
>;

/** Una evaluación que se puede comparar con la base (misma historia de instrumento). */
export type AssessmentComparisonCandidate = {
  assessmentId: string;
  assessmentName: string;
  instrumentId: string;
  instrumentName: string;
  academicYear: number | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  appliedAt: string | null; // ISO
  /** Estudiantes con resultado dentro del alcance del usuario. */
  studentsAssessed: number;
};

export type AssessmentComparisonCandidatesResponse = {
  base: AssessmentComparisonCandidate;
  data: AssessmentComparisonCandidate[];
};

/** Conteo de estudiantes en una banda del instrumento de ese lado. */
export type AssessmentComparisonBandCell = {
  bandKey: string;
  count: number;
  percentage: number; // 0..100 sobre los estudiantes del lado con banda resuelta
};

/** Un lado de la comparación (base o comparada), ya acotado a la cohorte pedida. */
export type AssessmentComparisonSide = AssessmentComparisonCandidate & {
  /** % de logro del grupo: `achievementPct` sobre tallies, sin redondear; `null` sin puntaje corregido. */
  achievementPct: number | null;
  /** Estudiantes detrás de `achievementPct` (puede diferir de los clasificados por banda). */
  achievementStudents: number;
  /** Bandas del instrumento de este lado; `[]` si no tiene. */
  bands: PerformanceBandView[];
  bandDistribution: AssessmentComparisonBandCell[];
  /** Estudiantes con banda resuelta (denominador de `bandDistribution`). */
  bandStudents: number;
};

/** Movimiento de un estudiante pareado entre la banda de la base y la de la comparada. */
export type AssessmentComparisonTransition = {
  fromBandKey: string;
  toBandKey: string;
  count: number;
};

/**
 * Resumen del movimiento entre niveles. Sólo existe cuando ambos instrumentos tienen
 * bandas con el mismo número de niveles (el orden es comparable); si no, `null`.
 */
export type AssessmentComparisonMovement = {
  improved: number;
  same: number;
  declined: number;
};

/** Logro por nodo de taxonomía evaluado en AMBAS evaluaciones. */
export type AssessmentComparisonNode = {
  nodeId: string;
  nodeName: string;
  nodeType: string | null;
  baseAchievementPct: number | null;
  comparisonAchievementPct: number | null;
  /** comparación − base, en puntos porcentuales; `null` si falta un lado. */
  deltaPp: number | null;
};

export type AssessmentComparisonResponse = {
  cohort: AssessmentComparisonCohort;
  base: AssessmentComparisonSide;
  comparison: AssessmentComparisonSide;
  /** Estudiantes que rindieron ambas, dentro del alcance del usuario. */
  pairedStudents: number;
  /** Se pidió `paired` pero no hay estudiantes en común: se compararon las cohortes completas. */
  fellBackToAll: boolean;
  transitions: AssessmentComparisonTransition[];
  movement: AssessmentComparisonMovement | null;
  nodes: AssessmentComparisonNode[];
};
