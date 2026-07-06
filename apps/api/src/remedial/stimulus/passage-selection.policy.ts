import type { RemedialStimulusRef } from '@soe/types';
import type { FailedStimulus } from './failed-stimulus.service';

/**
 * Puerto de selección de pasaje para el remedial con estímulo (Ola 2.1a). Decide QUÉ
 * pasaje(s) usar entre los candidatos fallados. Devuelve SIEMPRE una lista (1 elemento
 * en 2.1a) para que un futuro `MultiPassagePolicy` devuelva varios sin cambiar callers.
 */
export interface PassageSelectionPolicy {
  /**
   * Selecciona pasaje(s) entre los candidatos. Con `overrideSectionId` devuelve el
   * candidato que coincide (o `[]` si no está entre los candidatos); sin override, el
   * de mayor brecha (`candidates[0]`; el service los entrega ordenados por brecha desc).
   */
  select(candidates: FailedStimulus[], overrideSectionId?: string): RemedialStimulusRef[];
}

/** Token DI del puerto `PassageSelectionPolicy` (patrón `CURRICULUM_RETRIEVER`). */
export const PASSAGE_SELECTION_POLICY = 'PASSAGE_SELECTION_POLICY';
