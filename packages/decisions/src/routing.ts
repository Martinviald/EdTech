/**
 * Routing por confianza: convierte una respuesta en una acción según umbrales
 * calibrados por pregunta. Choice/Score usan `confidence`; Noul usa P(sí).
 */

import {
  DecisionError,
  type ConfidenceRoute,
  type ConfidenceThresholds,
  type NoulThresholds,
  type NoulVerdict,
} from './contracts';

const inUnitRange = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/**
 * Verifica la invariante de los umbrales. Choice/Score: `0 <= review <= auto <= 1`.
 * Noul: `0 <= no < yes <= 1`. Lanza `DecisionError('invalid_request')`.
 */
export function assertValidThresholds(thresholds: ConfidenceThresholds | NoulThresholds): void {
  if ('auto' in thresholds) {
    const { auto, review } = thresholds;
    if (!inUnitRange(auto) || !inUnitRange(review) || review > auto) {
      throw new DecisionError(
        'invalid_request',
        `Umbrales de confianza inválidos (auto=${String(auto)}, review=${String(review)}); se requiere 0 <= review <= auto <= 1.`,
      );
    }
    return;
  }
  const { yes, no } = thresholds;
  if (!inUnitRange(yes) || !inUnitRange(no) || no >= yes) {
    throw new DecisionError(
      'invalid_request',
      `Umbrales Noul inválidos (yes=${String(yes)}, no=${String(no)}); se requiere 0 <= no < yes <= 1.`,
    );
  }
}

/** `confidence >= auto` → `auto`; `>= review` → `review`; si no, `reject`. */
export function routeByConfidence(
  confidence: number,
  thresholds: ConfidenceThresholds,
): ConfidenceRoute {
  assertValidThresholds(thresholds);
  if (confidence >= thresholds.auto) return 'auto';
  if (confidence >= thresholds.review) return 'review';
  return 'reject';
}

/** `probability >= yes` → `yes`; `<= no` → `no`; si no, `uncertain`. */
export function routeNoul(probability: number, thresholds: NoulThresholds): NoulVerdict {
  assertValidThresholds(thresholds);
  if (probability >= thresholds.yes) return 'yes';
  if (probability <= thresholds.no) return 'no';
  return 'uncertain';
}
