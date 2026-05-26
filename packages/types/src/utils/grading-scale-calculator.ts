/**
 * Conversión porcentaje → nota según escala configurable.
 *
 * H5.7 — "Convertir puntaje a nota según escala configurable por colegio
 * (60% exigencia, base 4.0)".
 *
 * Modelo lineal por tramos (default chileno):
 *   - 0% logro                → minGrade
 *   - passingThreshold logro  → passingGrade
 *   - 100% logro              → maxGrade
 *
 * El tramo bajo (0..passingThreshold) interpola entre minGrade y passingGrade;
 * el tramo alto (passingThreshold..1) interpola entre passingGrade y maxGrade.
 * Esto permite que un 60% de exigencia siempre rinda 4.0 sin importar las
 * notas extremas — la forma estándar chilena.
 */
export interface GradingScaleParams {
  minGrade: number;
  maxGrade: number;
  passingGrade: number;
  passingThreshold: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Convierte un porcentaje de logro (0..1) a nota usando la escala dada.
 * Retorna la nota redondeada a 1 decimal.
 *
 * @param percentage Valor entre 0 y 1 (e.g. 0.6 = 60% de logro).
 * @param scale Parámetros de la escala (minGrade, maxGrade, passingGrade, passingThreshold).
 */
export function percentageToGrade(percentage: number, scale: GradingScaleParams): number {
  if (!Number.isFinite(percentage)) {
    throw new Error('percentageToGrade: percentage debe ser finito');
  }

  const { minGrade, maxGrade, passingGrade, passingThreshold } = scale;

  if (!(minGrade < passingGrade && passingGrade < maxGrade)) {
    throw new Error(
      'percentageToGrade: la escala viola el invariante minGrade < passingGrade < maxGrade',
    );
  }
  if (!(passingThreshold > 0 && passingThreshold < 1)) {
    throw new Error('percentageToGrade: passingThreshold debe estar entre 0 y 1 (exclusivo)');
  }

  // Clampeo de los extremos para evitar notas fuera de rango.
  if (percentage <= 0) return round1(minGrade);
  if (percentage >= 1) return round1(maxGrade);

  if (percentage < passingThreshold) {
    // Tramo bajo lineal.
    const ratio = percentage / passingThreshold;
    return round1(minGrade + ratio * (passingGrade - minGrade));
  }

  // Tramo alto lineal.
  const ratio = (percentage - passingThreshold) / (1 - passingThreshold);
  return round1(passingGrade + ratio * (maxGrade - passingGrade));
}

/**
 * `true` si la nota supera (>=) la nota de aprobación de la escala.
 */
export function isPassingGrade(grade: number, scale: GradingScaleParams): boolean {
  return grade >= scale.passingGrade;
}
