/**
 * Consenso de dos motores sobre la MISMA pregunta Choice, cada uno con sus
 * propios umbrales (`PairThresholds`). No sabe de dominio: solo combina dos
 * `ChoiceAnswer` y decide si la elección puede aplicarse sola o va a revisión.
 *
 * Tabla (A y B son los dos motores; `ca/pa` y `cb/pb`, su opción y su confianza),
 * evaluada en orden:
 *
 * 1. A o B fallaron → `engine_failed` (revisión).
 * 2. Alguna opción fuera de `options` o confianza no finita / fuera de [0,1] → `engine_failed`.
 * 3. `ca = cb`, `pa >= agreeA` y `pb >= agreeB` → `agree` (automática, `ca`).
 * 4. `ca = cb` y alguna bajo su `agree` → `low_agreement` (revisión).
 * 5. `ca ≠ cb`, `pa >= soloA` y `pb < unsureB` → `solo_a` (automática, `ca`).
 * 6. `ca ≠ cb`, `pb >= soloB` y `pa < unsureA` → `solo_b` (automática, `cb`).
 * 7. Cualquier otro `ca ≠ cb` → `conflict` (revisión).
 *
 * Nunca se acepta con un solo motor: si uno falla, la respuesta del otro no basta.
 */

import type { ChoiceAnswer, DecisionErrorCode, PairThresholds } from './contracts';
import { assertValidThresholds } from './routing';

/** Lo que devolvió un motor: su respuesta, o por qué falló (`dropped` = la llamada se descartó). */
export type PairSide =
  | { readonly status: 'ok'; readonly answer: ChoiceAnswer<string> }
  | { readonly status: 'failed'; readonly code: DecisionErrorCode | 'dropped' };

export type PairVerdict =
  | 'agree'
  | 'solo_a'
  | 'solo_b'
  | 'low_agreement'
  | 'conflict'
  | 'engine_failed';

/** Veredictos del combinador, en el orden de la tabla. */
export const PAIR_VERDICT_VALUES: readonly PairVerdict[] = [
  'agree',
  'solo_a',
  'solo_b',
  'low_agreement',
  'conflict',
  'engine_failed',
];

export interface PairConsensus {
  readonly verdict: PairVerdict;
  /** `auto` = la elección puede aplicarse sin revisión humana. */
  readonly route: 'auto' | 'review';
  /** La opción a aplicar si `route = 'auto'`; `null` en revisión. */
  readonly choice: string | null;
}

const REVIEW = (verdict: PairVerdict): PairConsensus => ({
  verdict,
  route: 'review',
  choice: null,
});

const isValidConfidence = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/**
 * Combina las respuestas de los motores A y B. `options` es la lista COMPLETA de
 * claves válidas de la pregunta. Lanza `DecisionError('invalid_request')` si algún
 * juego de umbrales viola `0 <= unsure <= agree <= solo <= 1`.
 */
export function pairConsensus(
  a: PairSide,
  b: PairSide,
  ta: PairThresholds,
  tb: PairThresholds,
  options: readonly string[],
): PairConsensus {
  assertValidThresholds(ta);
  assertValidThresholds(tb);
  if (a.status !== 'ok' || b.status !== 'ok') return REVIEW('engine_failed');

  const valid = new Set(options);
  const { choice: ca, confidence: pa } = a.answer;
  const { choice: cb, confidence: pb } = b.answer;
  if (!valid.has(ca) || !valid.has(cb) || !isValidConfidence(pa) || !isValidConfidence(pb)) {
    return REVIEW('engine_failed');
  }

  if (ca === cb) {
    if (pa >= ta.agree && pb >= tb.agree) return { verdict: 'agree', route: 'auto', choice: ca };
    return REVIEW('low_agreement');
  }
  if (pa >= ta.solo && pb < tb.unsure) return { verdict: 'solo_a', route: 'auto', choice: ca };
  if (pb >= tb.solo && pa < ta.unsure) return { verdict: 'solo_b', route: 'auto', choice: cb };
  return REVIEW('conflict');
}
