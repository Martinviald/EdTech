/**
 * Métricas puras de la calibración (sin red ni BDD): tramos de confianza,
 * curva cobertura/exactitud, acuerdo de Noul y percentiles.
 */

export interface ScoredDecision {
  confidence: number;
  correct: boolean;
}

export interface CalibrationRow {
  label: string;
  n: number;
  /** Fracción de aciertos del tramo (`null` si el tramo está vacío). */
  accuracy: number | null;
  meanConfidence: number | null;
  /** Fracción del total que cae en el tramo. */
  share: number;
}

/** Tramos pedidos para la tabla de calibración (el último incluye 1.0). */
export const CONFIDENCE_BINS: readonly { label: string; lo: number; hi: number }[] = [
  { label: '[0, 0.5)', lo: 0, hi: 0.5 },
  { label: '[0.5, 0.7)', lo: 0.5, hi: 0.7 },
  { label: '[0.7, 0.85)', lo: 0.7, hi: 0.85 },
  { label: '[0.85, 0.95)', lo: 0.85, hi: 0.95 },
  { label: '[0.95, 1]', lo: 0.95, hi: Number.POSITIVE_INFINITY },
];

export const COVERAGE_THRESHOLDS: readonly number[] = [
  0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
];

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function accuracyOf(records: readonly ScoredDecision[]): number | null {
  if (records.length === 0) return null;
  let ok = 0;
  for (const r of records) if (r.correct) ok++;
  return ok / records.length;
}

export function calibrationTable(records: readonly ScoredDecision[]): CalibrationRow[] {
  const total = records.length;
  return CONFIDENCE_BINS.map((bin) => {
    const inBin = records.filter((r) => r.confidence >= bin.lo && r.confidence < bin.hi);
    return {
      label: bin.label,
      n: inBin.length,
      accuracy: accuracyOf(inBin),
      meanConfidence: mean(inBin.map((r) => r.confidence)),
      share: total === 0 ? 0 : inBin.length / total,
    };
  });
}

export interface CoveragePoint {
  threshold: number;
  /** Cuántas decisiones quedan con `confidence >= threshold`. */
  n: number;
  coverage: number;
  accuracy: number | null;
}

export function coverageCurve(
  records: readonly ScoredDecision[],
  thresholds: readonly number[] = COVERAGE_THRESHOLDS,
): CoveragePoint[] {
  const total = records.length;
  return thresholds.map((threshold) => {
    const kept = records.filter((r) => r.confidence >= threshold);
    return {
      threshold,
      n: kept.length,
      coverage: total === 0 ? 0 : kept.length / total,
      accuracy: accuracyOf(kept),
    };
  });
}

/**
 * Menor umbral cuya exactitud alcanza `target` con al menos `minN` decisiones
 * cubiertas. `null` si ningún umbral lo logra (o no hay datos suficientes).
 */
export function suggestThreshold(
  curve: readonly CoveragePoint[],
  target = 0.95,
  minN = 10,
): CoveragePoint | null {
  for (const point of curve) {
    if (point.n >= minN && point.accuracy !== null && point.accuracy >= target) return point;
  }
  return null;
}

export interface NoulAgreement {
  n: number;
  /** Acuerdo al cortar P(sí) en 0.5 contra el veredicto de referencia. */
  agreement: number | null;
  meanWhenReferenceTrue: number | null;
  meanWhenReferenceFalse: number | null;
  referenceTrue: number;
}

export function noulAgreement(
  records: readonly { probability: number; reference: boolean }[],
): NoulAgreement {
  const agree = records.filter((r) => r.probability >= 0.5 === r.reference).length;
  const whenTrue = records.filter((r) => r.reference).map((r) => r.probability);
  const whenFalse = records.filter((r) => !r.reference).map((r) => r.probability);
  return {
    n: records.length,
    agreement: records.length === 0 ? null : agree / records.length,
    meanWhenReferenceTrue: mean(whenTrue),
    meanWhenReferenceFalse: mean(whenFalse),
    referenceTrue: whenTrue.length,
  };
}

export interface ProbabilitySummary {
  n: number;
  mean: number | null;
  p10: number | null;
  min: number | null;
  /** Fracción con P(sí) >= 0.5. */
  shareYes: number | null;
}

export function summarizeProbabilities(values: readonly number[]): ProbabilitySummary {
  return {
    n: values.length,
    mean: mean(values),
    p10: percentile(values, 10),
    min: values.length === 0 ? null : Math.min(...values),
    shareYes: values.length === 0 ? null : values.filter((v) => v >= 0.5).length / values.length,
  };
}

/** Percentil por rango más cercano (p en 0..100). */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

// ── Formato ──────────────────────────────────────────────────────────────────

export function pct(value: number | null, digits = 1): string {
  return value === null ? '—' : `${(value * 100).toFixed(digits)}%`;
}

export function num(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}

export function mdTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) =>
    `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}
