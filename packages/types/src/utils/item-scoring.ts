// Clasificación de un ítem según pueda o no producir puntaje parcial.
//
// KR-20, el alfa de Cronbach y el punto-biserial están DEFINIDOS para ítems
// dicotómicos. Un ítem de crédito parcial metido en esa matriz booleana colapsa
// a 0 y sesga la varianza sin que nada avise. El criterio se centraliza acá para
// que los consumidores psicométricos filtren por dato y no por una lista de tipos
// repetida en cada uno.

import type { ItemType } from '../enums';
import type { ScoringConfig } from '../schemas/item.schema';

/** Tipos que SIEMPRE producen puntaje parcial, cualquiera sea su configuración. */
const ALWAYS_POLYTOMOUS_ITEM_TYPES: readonly ItemType[] = ['rubric_scored'];

/**
 * ¿El ítem puntúa 0 o el máximo, sin valores intermedios?
 *
 * Depende del tipo Y de la configuración: un `matching` es dicotómico salvo que
 * declare `partialCredit`, y un `multi_select` lo es salvo que apague
 * `requireExact`. Ambos defaults coinciden con las estrategias correspondientes.
 */
export function isDichotomousItem(type: ItemType, scoringConfig?: ScoringConfig): boolean {
  if (ALWAYS_POLYTOMOUS_ITEM_TYPES.includes(type)) return false;
  if (type === 'matching') return scoringConfig?.partialCredit !== true;
  if (type === 'multi_select') return scoringConfig?.multiSelect?.requireExact !== false;
  return true;
}
