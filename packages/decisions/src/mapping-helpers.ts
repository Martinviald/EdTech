/**
 * Helpers compartidos por los mappings de los adaptadores (`jev/`, `openai/`).
 * No se re-exportan en `index`: son internos del paquete.
 */

import { DecisionError } from './contracts';

/** @internal */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** @internal Error `upstream` para una respuesta que no calza con lo esperado. */
export function malformed(provider: string, detail: string): DecisionError {
  return new DecisionError('upstream', `Respuesta inesperada de ${provider}: ${detail}.`);
}

/** Índice del máximo; ante empate gana el índice menor. `-1` si el arreglo está vacío. */
export function argmax(values: readonly number[]): number {
  let best = -1;
  let bestValue = Number.NEGATIVE_INFINITY;
  values.forEach((value, index) => {
    if (value > bestValue) {
      best = index;
      bestValue = value;
    }
  });
  return best;
}

/**
 * Pares `[nivel, probabilidad]` → arreglo indexado por nivel, de largo `levels`.
 * Los niveles ausentes quedan en 0; los índices fuera de rango se ignoran; una
 * probabilidad no numérica lanza `upstream`.
 */
export function levelProbabilitiesToArray(
  entries: Iterable<readonly [unknown, unknown]>,
  levels: number,
  provider: string,
): number[] {
  const out = new Array<number>(levels).fill(0);
  for (const [key, value] of entries) {
    const index = typeof key === 'number' ? key : Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= levels) continue;
    if (!isFiniteNumber(value)) {
      throw malformed(provider, `la probabilidad del nivel ${String(key)} no es numérica`);
    }
    out[index] = value;
  }
  return out;
}

/**
 * Probabilidad por opción de un Choice, en el orden de `options`. Las opciones
 * ausentes en `lookup` quedan en 0; una probabilidad no numérica lanza `upstream`.
 */
export function choiceProbabilities(
  options: readonly string[],
  lookup: (option: string) => unknown,
  provider: string,
  questionId: string,
): Record<string, number> {
  const byOption: Record<string, number> = {};
  for (const option of options) {
    const p = lookup(option);
    if (p === undefined) {
      byOption[option] = 0;
      continue;
    }
    if (!isFiniteNumber(p)) {
      throw malformed(provider, `la probabilidad de "${option}" en "${questionId}" no es numérica`);
    }
    byOption[option] = p;
  }
  return byOption;
}
