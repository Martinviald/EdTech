// ─────────────────────────────────────────────────────────────────────────────
// Copy oficial de los informes (TKT-24/25/26).
//
// El backend expone `meta.disclaimers` / `levelDefinitions` como DATOS: si algún
// día el instrumento los define en `config`, llegan poblados y la plantilla los
// usa tal cual. Mientras estén vacíos, el frontend inyecta la copia oficial que
// aquí se define (data-driven con fallback). Nada de esto ramifica lógica por el
// valor del instrumento — es sólo texto de plantilla.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recuadro de advertencia de uso (portada). Copia oficial que se muestra cuando
 * el instrumento no define `config.reportDisclaimers`.
 */
export const DEFAULT_REPORT_DISCLAIMERS: readonly string[] = [
  'Recuerde que esta información NO DEBE ser usada para: evaluar el desempeño de las y los docentes; realizar comparaciones entre cursos, asignaturas y/o áreas; realizar comparaciones con el DIA Diagnóstico ni con las evaluaciones del DIA 2024.',
];

/**
 * Definición interpretativa de los niveles de logro (I/II/III). Se muestra cuando
 * el instrumento no define `config.levelDefinitions`.
 */
export const DEFAULT_LEVEL_DEFINITIONS: readonly string[] = [
  'Nivel I: no logra los aprendizajes mínimos de los Objetivos de Aprendizaje (OA) basales.',
  'Nivel II: logra parcialmente los aprendizajes de los OA basales.',
  'Nivel III: logra satisfactoriamente los aprendizajes de los OA basales.',
];

/** Devuelve los disclaimers del backend si vienen poblados; si no, la copia oficial. */
export function resolveDisclaimers(fromMeta: readonly string[] | null | undefined): string[] {
  return fromMeta && fromMeta.length > 0 ? [...fromMeta] : [...DEFAULT_REPORT_DISCLAIMERS];
}

/** Devuelve las definiciones de nivel del backend si vienen; si no, la copia oficial. */
export function resolveLevelDefinitions(
  fromMeta: readonly string[] | null | undefined,
): string[] {
  return fromMeta && fromMeta.length > 0 ? [...fromMeta] : [...DEFAULT_LEVEL_DEFINITIONS];
}
