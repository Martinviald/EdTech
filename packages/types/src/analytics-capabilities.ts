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
 * ⚠️ REGLA DE ESTA LISTA: una capacidad se declara sólo si algo la APLICA hoy. Una
 * capacidad declarada y no aplicada es peor que no declararla, porque promete una
 * garantía que nadie cumple. Cada entrada de abajo dice dónde se aplica; si agregas
 * una y no puedes contestar esa pregunta, no la agregues.
 *
 * Hay DOS mecanismos de aplicación, y no son intercambiables:
 *
 *  1. `@RequireCapability` + `CapabilityGuard` → 409. Es para rutas cuya respuesta
 *     COMPLETA depende de la capacidad. Sirve donde degradar mentiría: sin
 *     `responses`, `instrument-quality` no muestra un vacío sino que AFIRMA mala
 *     calidad, y `ai-analysis` le da al LLM un snapshot sin psicometría ni señal de
 *     "no aplica" (§2.8 del plan).
 *  2. `meta.capabilities` en el payload del informe → la UI colapsa la sección con el
 *     motivo. Es para rutas MIXTAS, que sirven varias capacidades a la vez. Ahí el
 *     guard no sirve: cierra la ruta entera y de paso niega las capacidades que SÍ
 *     funcionan. Ejemplo vivo: `/item-analysis/matrix` devuelve `questions[]` (que es
 *     `cohort_item_stats`, y con datos agregados viene completo desde el read-model)
 *     junto con `students[]` (que es `student_matrix`). Cerrarla rompería el
 *     drill-down de habilidades y el análisis IA, que piden `limit=1` porque sólo
 *     quieren `questions` (§2.5). El punto de corte correcto para esos casos es el
 *     payload, no la ruta.
 *
 * Ver docs/plan-analitica-agregada-informes-oficiales.md §2.8 y §4.
 */

export const DATA_GRANULARITIES = ['item_level', 'aggregate_only'] as const;
export type DataGranularity = (typeof DATA_GRANULARITIES)[number];

export const ANALYTICS_CAPABILITIES = [
  /**
   * % de logro por pregunta + distribución de alternativas (read-model de cohorte).
   * Aplicada: contenido positivo de `capabilitiesFor`; la sirve `assessment-report`
   * (`items[]`) e `item-analysis` (`questions[]`) desde `assessment_item_stats`.
   */
  'cohort_item_stats',
  /**
   * % de logro por eje de habilidad (read-model de cohorte).
   * Aplicada: `assessment-report.skills[]`, dashboards y heatmap, todos sobre
   * `assessment_skill_stats`.
   */
  'cohort_skill_stats',
  /**
   * Nivel de logro por alumno (`assessment_results`).
   * Aplicada: `assessment-report` distribución por banda + nómina en foco, que leen
   * la banda de la fila y no re-clasifican un `percentage` que el informe no trae.
   */
  'student_levels',
  /**
   * Matriz alumno × pregunta. Irreducible: requiere `responses`.
   * Aplicada por PAYLOAD (mecanismo 2), no por guard: `meta.capabilities` →
   * `evaluaciones/[id]/detalle/page.tsx`, que pinta el `EmptyState` con el motivo del
   * backend. `/item-analysis/matrix` es una ruta mixta y cerrarla negaría
   * `cohort_item_stats` a sus tres consumidores de `limit=1` (§2.5).
   * También la cita el guard de escritura de `assessment-results` (recálculo).
   */
  'student_matrix',
  /**
   * Detalle respuesta a respuesta de un alumno. Requiere `responses`.
   * Aplicada por GUARD: `@RequireCapability('student_detail')` en `assessment-results`
   * (`GET /assessments/:assessmentId/results/:studentId`). Ruta de capacidad única y
   * con el `assessmentId` en el path, que es de donde el guard lo resuelve.
   */
  'student_detail',
  /**
   * KR-20, punto-biserial, discriminación. Requieren la ScoreMatrix alumno×ítem.
   * Aplicada por GUARD: `@RequireCapability('psychometrics')` en `instrument-quality`.
   */
  'psychometrics',
  /**
   * Cargar hojas de respuesta contra la evaluación.
   * Aplicada: `answer-sheets.service.confirm()` responde 409 con este código.
   */
  'answer_sheet_import',
  /**
   * Snapshots IA que leen `responses` (análisis de evaluación e insight de ítem).
   * Aplicada por GUARD: `@RequireCapability('ai_item_insight')` en `ai-analysis`.
   */
  'ai_item_insight',
] as const;
export type AnalyticsCapability = (typeof ANALYTICS_CAPABILITIES)[number];

/**
 * ── Capacidades RETIRADAS (2026-07-15), por la regla de arriba ──────────────────
 *
 * Estaba declarada y NADA la aplicaba: ni un guard, ni el payload, ni la web.
 * Prometía una garantía inexistente, así que se sacó en vez de dejarla de adorno.
 * Vuelve el día que alguien la aplique de verdad:
 *
 * · `remedial_stimulus` (identificación de estímulos fallados). NO es guardable sin
 *   daño: `/remedial/candidate-stimuli` es una ruta mixta —`fromAssessment` sale de
 *   `responses`, pero `fromBank` son pasajes del banco y no dependen del dato de la
 *   evaluación— y un 409 se llevaría también el banco, que es justo el fallback del
 *   modo A. Además `/remedial/generate` lleva el `assessmentId` en el BODY, que el
 *   guard no mira: decorarla habría sido un no-op silencioso, la peor variante de
 *   capacidad declarada y no aplicada. Hoy degrada bien: sin estímulos fallados,
 *   `generate-panel.tsx` cambia el método por defecto y explica por qué. Si se
 *   quiere el motivo exacto ("es un informe oficial") en vez del genérico, el
 *   camino es exponerlo por payload, como hace `detalle`.
 */

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
  };
  return detail[capability];
}
