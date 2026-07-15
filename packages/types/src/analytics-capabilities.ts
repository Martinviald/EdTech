/**
 * Capacidades de analítica por granularidad del dato.
 *
 * Hermano de `access-policies.ts` y con la misma filosofía: la lista vive UNA vez y
 * se importa tanto en `api` (guards) como en `web` (gating de UI). No duplicar.
 *
 * El problema que resuelve: una evaluación cargada desde un informe oficial DIA no
 * tiene respuestas alumno×pregunta. Los flujos que las exigen no deben "degradar a
 * vacío" — deben cerrarse explícitamente. Degradar en silencio no es neutro: sin
 * `responses`, `instrument-quality` no muestra un vacío, **afirma mala calidad**
 * (KR-20 en warning + flags `misaligned` inflados), y `ai-analysis` le entrega al
 * LLM un snapshot sin psicometría y sin ninguna señal de "no aplica".
 *
 * Ver docs/plan-analitica-agregada-informes-oficiales.md §2.8 y §4.
 */

export const DATA_GRANULARITIES = ['item_level', 'aggregate_only'] as const;
export type DataGranularity = (typeof DATA_GRANULARITIES)[number];

export const ANALYTICS_CAPABILITIES = [
  /** % de logro por pregunta + distribución de alternativas (read-model de cohorte). */
  'cohort_item_stats',
  /** % de logro por eje de habilidad (read-model de cohorte). */
  'cohort_skill_stats',
  /** Nivel de logro por alumno (assessment_results). */
  'student_levels',
  /** Matriz alumno × pregunta. Irreducible: requiere `responses`. */
  'student_matrix',
  /** Detalle respuesta a respuesta de un alumno. Requiere `responses`. */
  'student_detail',
  /** KR-20, punto-biserial, discriminación. Requieren la ScoreMatrix alumno×ítem. */
  'psychometrics',
  /** Cargar hojas de respuesta contra la evaluación. */
  'answer_sheet_import',
  /** Snapshots IA que leen `responses` (análisis de evaluación e insight de ítem). */
  'ai_item_insight',
  /** Identificación de estímulos fallados para material remedial. */
  'remedial_stimulus',
] as const;
export type AnalyticsCapability = (typeof ANALYTICS_CAPABILITIES)[number];

/**
 * Capacidades disponibles con datos agregados por curso.
 *
 * Todo lo que NO está acá requiere `responses` alumno×pregunta. Nótese que
 * `cohort_item_stats` sí está: el % por pregunta y la distribución de alternativas
 * son agregables por definición y el informe oficial los trae.
 */
const AGGREGATE_ONLY_CAPABILITIES: readonly AnalyticsCapability[] = [
  'cohort_item_stats',
  'cohort_skill_stats',
  'student_levels',
];

const BY_GRANULARITY: Record<DataGranularity, readonly AnalyticsCapability[]> = {
  item_level: ANALYTICS_CAPABILITIES,
  aggregate_only: AGGREGATE_ONLY_CAPABILITIES,
};

/** Capacidades de una granularidad dada. */
export function capabilitiesFor(granularity: DataGranularity): readonly AnalyticsCapability[] {
  return BY_GRANULARITY[granularity];
}

/** ¿Esta granularidad soporta esta capacidad? */
export function supportsCapability(
  granularity: DataGranularity,
  capability: AnalyticsCapability,
): boolean {
  return BY_GRANULARITY[granularity].includes(capability);
}

/**
 * Código de error legible por máquina cuando falta una capacidad. La web lo usa para
 * pintar un estado vacío específico en vez de un error genérico. Mismo espíritu que
 * `suppressed` + `suppressionReason` del benchmarking: el backend decide Y explica.
 */
export const CAPABILITY_UNAVAILABLE_CODE = 'REQUIRES_ITEM_LEVEL_DATA';

export type CapabilityUnavailableError = {
  statusCode: 409;
  error: 'CapabilityUnavailable';
  code: typeof CAPABILITY_UNAVAILABLE_CODE;
  capability: AnalyticsCapability;
  message: string;
};

/** Mensaje al usuario cuando una capacidad no aplica por la granularidad del dato. */
export function capabilityUnavailableMessage(capability: AnalyticsCapability): string {
  const detail: Record<AnalyticsCapability, string> = {
    cohort_item_stats: 'Esta evaluación no tiene resultados por pregunta.',
    cohort_skill_stats: 'Esta evaluación no tiene resultados por habilidad.',
    student_levels: 'Esta evaluación no tiene niveles de logro por estudiante.',
    student_matrix:
      'Esta evaluación se cargó desde un informe oficial, que entrega resultados agregados por curso y no las respuestas de cada estudiante.',
    student_detail:
      'Esta evaluación se cargó desde un informe oficial y no tiene el detalle de respuestas de cada estudiante.',
    psychometrics:
      'El análisis de calidad del instrumento necesita las respuestas de cada estudiante, que un informe oficial no entrega.',
    answer_sheet_import:
      'Esta evaluación se cargó desde un informe oficial. Para cargar hojas de respuesta, cree una evaluación nueva.',
    ai_item_insight:
      'El análisis con IA necesita las respuestas de cada estudiante, que un informe oficial no entrega.',
    remedial_stimulus:
      'La selección de textos fallados necesita las respuestas de cada estudiante, que un informe oficial no entrega.',
  };
  return detail[capability];
}
