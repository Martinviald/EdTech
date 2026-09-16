/**
 * Escape de comodines para un patrón `LIKE`/`ILIKE`.
 *
 * Vive acá y no en el backend porque es lógica pura y testeable, y porque el CI
 * corre los tests de `@soe/types` en cada PR (CLAUDE.md §3).
 */

/**
 * Neutraliza los metacaracteres de `LIKE` (`%`, `_`) y la barra que los escapa.
 *
 * Sin esto, buscar "100%" no filtra nada: el `%` actúa como comodín y devuelve el
 * catálogo entero. La barra se escapa PRIMERO, o se volverían a escapar las
 * barras que este mismo reemplazo acaba de introducir.
 *
 * `\` es el carácter de escape por defecto de `LIKE` en PostgreSQL con
 * `standard_conforming_strings` activo, así que no hace falta cláusula `ESCAPE`.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Patrón "contiene" (`%término%`) con el término ya escapado. */
export function buildContainsPattern(term: string): string {
  return `%${escapeLikePattern(term)}%`;
}
