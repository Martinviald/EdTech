import type { PerformanceBandInput } from './grade-calculator';
import { reconstructCountsFromPercentages } from './item-stats-calculator';

/**
 * Helpers PUROS para el read-model de distribución por nivel (`assessment_level_stats`).
 *
 * Viven en `packages/types` a propósito: el importador (`apps/api`) y el backfill
 * (`packages/db`) los comparten, y `packages/db` NO puede importar de `apps/api`.
 * Sin dependencias de infraestructura: solo aritmética sobre el % + N del informe.
 *
 * El mapeo nivel→banda replica `resolveLevelBand` (evaluate-gates): matchea por
 * key/label/último-token del label, todo normalizado. `resolveLevelBand` delega
 * acá para no duplicar la semántica.
 */

/**
 * Normaliza para comparar niveles contra bandas: sin diacríticos, mayúsculas, sin
 * puntuación, espacios colapsados. Misma transformación que `normalizeName` del
 * matcher de nombres, replicada acá para no atar `packages/types` a `apps/api`.
 */
function normalizeLevel(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Resuelve la banda de logro que corresponde a un nivel del informe (ej. "I",
 * "Nivel II", "Adecuado"). Matchea si la clave, la etiqueta o el ÚLTIMO token de la
 * etiqueta de la banda coincide con el nivel normalizado — el último token, no un
 * `endsWith` suelto, para que "NIVEL II" no cruce con "I".
 *
 * Devuelve la banda solo si hay EXACTAMENTE una coincidencia; `null` si ninguna o
 * si es ambiguo (dos bandas matchean).
 */
export function matchLevelToBand(
  level: string,
  bands: readonly PerformanceBandInput[],
): PerformanceBandInput | null {
  const target = normalizeLevel(level);
  if (target.length === 0) return null;
  const matches = bands.filter((b) => {
    const key = normalizeLevel(b.key);
    const label = normalizeLevel(b.label);
    if (key === target || label === target) return true;
    const lastLabelToken = label.split(' ').at(-1);
    return lastLabelToken === target;
  });
  return matches.length === 1 ? matches[0]! : null;
}

export type LevelStatCount = {
  performanceBandId: string;
  studentCount: number;
};

/**
 * Traduce la distribución por nivel de un informe (`{level, pct}` + N del curso) a
 * conteos enteros por banda, listos para escribir en `assessment_level_stats`.
 *
 * Reconstruye el conteo con `round(pct/100 × N)` (ver `reconstructCountsFromPercentages`).
 *
 * Devuelve `[]` (no escribir nada) si:
 *  - la distribución viene vacía (informe sin Gráfico 1), o
 *  - algún nivel no matchea una única banda, o
 *  - dos niveles matchean la misma banda (ambigüedad).
 *
 * Es todo-o-nada: un solo nivel sin banda invalida la escritura, porque una
 * distribución parcial sería peor que ninguna (torta que no suma N).
 */
export function buildLevelStatCounts(input: {
  levelDistribution: readonly { level: string; pct: number }[];
  studentCount: number;
  bands: readonly PerformanceBandInput[];
}): LevelStatCount[] {
  const { levelDistribution, studentCount, bands } = input;
  if (levelDistribution.length === 0) return [];

  const matched: { band: PerformanceBandInput; pct: number }[] = [];
  const usedBandIds = new Set<string>();
  for (const l of levelDistribution) {
    const band = matchLevelToBand(l.level, bands);
    if (!band) return [];
    if (usedBandIds.has(band.id)) return [];
    usedBandIds.add(band.id);
    matched.push({ band, pct: l.pct });
  }

  const counts = reconstructCountsFromPercentages(
    matched.map((m) => m.pct),
    studentCount,
  );
  return matched.map((m, i) => ({
    performanceBandId: m.band.id,
    studentCount: counts[i]!,
  }));
}
