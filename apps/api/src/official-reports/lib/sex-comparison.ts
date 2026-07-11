import type { SexComparisonResult } from '@soe/types';

// Comparación por sexo (TKT-25, Tablas 1.5–1.8). Determinística, sin IA.
//
// Regla (documentada en el contrato): t de Welch (dos muestras, varianzas
// desiguales) sobre el % de logro. Significativo a ~95% si |t| > 1.96. Requiere
// un mínimo de estudiantes por grupo (`MIN_GROUP_N`) para calcular; si no, el
// resultado es `insufficient_sample` (el "*" del informe oficial). Los umbrales
// son convenciones configurables, NO el cálculo oficial exacto de la Agencia.

/** Mínimo de estudiantes por grupo para intentar el cálculo de significancia. */
export const MIN_GROUP_N = 6;

/** Umbral crítico de |t| para significancia (~95% de confianza). */
export const T_CRITICAL = 1.96;

export type SexComparisonOutcome = {
  result: SexComparisonResult;
  femaleAvg: number | null;
  maleAvg: number | null;
  femaleN: number;
  maleN: number;
};

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Varianza muestral (n-1). Devuelve 0 si n < 2. */
function sampleVariance(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  const ss = xs.reduce((acc, x) => acc + (x - m) * (x - m), 0);
  return ss / (xs.length - 1);
}

/**
 * Compara los % de logro de mujeres vs hombres.
 * @param female % de logro (0..100) de cada mujer.
 * @param male   % de logro (0..100) de cada hombre.
 */
export function compareSexes(female: number[], male: number[]): SexComparisonOutcome {
  const femaleN = female.length;
  const maleN = male.length;
  const femaleAvg = femaleN > 0 ? mean(female) : null;
  const maleAvg = maleN > 0 ? mean(male) : null;

  if (femaleN < MIN_GROUP_N || maleN < MIN_GROUP_N) {
    return { result: 'insufficient_sample', femaleAvg, maleAvg, femaleN, maleN };
  }

  const vF = sampleVariance(female, femaleAvg!);
  const vM = sampleVariance(male, maleAvg!);
  const se = Math.sqrt(vF / femaleN + vM / maleN);

  // Sin dispersión en ninguno de los grupos: sólo hay diferencia si las medias difieren.
  if (se === 0) {
    if (femaleAvg! > maleAvg!) return { result: 'more_female', femaleAvg, maleAvg, femaleN, maleN };
    if (maleAvg! > femaleAvg!) return { result: 'more_male', femaleAvg, maleAvg, femaleN, maleN };
    return { result: 'no_difference', femaleAvg, maleAvg, femaleN, maleN };
  }

  const t = (femaleAvg! - maleAvg!) / se;
  if (Math.abs(t) <= T_CRITICAL) {
    return { result: 'no_difference', femaleAvg, maleAvg, femaleN, maleN };
  }
  return {
    result: t > 0 ? 'more_female' : 'more_male',
    femaleAvg,
    maleAvg,
    femaleN,
    maleN,
  };
}
