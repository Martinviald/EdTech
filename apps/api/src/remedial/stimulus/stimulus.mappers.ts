import type { RemedialStimulus, RemedialStimulusRef } from '@soe/types';
import type { FailedStimulus } from './failed-stimulus.service';

/**
 * Mappers de estímulo (Ola 2.1a). Fuente única (DRY) de la conversión entre las tres
 * formas del estímulo: `FailedStimulus` (recuperado con texto completo + brecha),
 * `RemedialStimulusRef` (ref ligera con preview, para pickers/banco/`content.stimuli`)
 * y `RemedialStimulus` (hidratado con texto completo, para la respuesta/resolución).
 */

/** Largo máximo del preview de texto de un estímulo en las refs ligeras. */
export const STIMULUS_TEXT_PREVIEW_MAX = 240;

/** Trunca el texto del pasaje para las refs ligeras (picker/banco). `null` si no hay. */
export function stimulusTextPreview(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= STIMULUS_TEXT_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, STIMULUS_TEXT_PREVIEW_MAX).trimEnd()}…`;
}

/**
 * Ref ligera (con preview) de un pasaje fallado. Los pasajes fallados de 2.1a son
 * oficiales (vienen de la evaluación); el `source` se propaga desde la sección.
 */
export function failedStimulusToRef(stimulus: FailedStimulus): RemedialStimulusRef {
  return {
    sectionId: stimulus.sectionId,
    kind: stimulus.kind,
    source: stimulus.source,
    title: stimulus.title,
    textPreview: stimulusTextPreview(stimulus.text),
  };
}

/** Estímulo hidratado (texto completo) desde un pasaje fallado ya recuperado. */
export function failedStimulusToStimulus(stimulus: FailedStimulus): RemedialStimulus {
  return {
    sectionId: stimulus.sectionId,
    kind: stimulus.kind,
    source: stimulus.source,
    title: stimulus.title,
    text: stimulus.text,
  };
}

/**
 * Estímulo hidratado desde una sección `ai_generated` recién insertada (Ola 2.2, Opción
 * B). El pasaje se genera con IA, por lo que `source` es siempre `ai_generated` (a
 * diferencia de los pasajes oficiales de la Opción A).
 */
export function generatedSectionToStimulus(section: {
  id: string;
  passageTitle: string | null;
  passageText: string | null;
}): RemedialStimulus {
  return {
    sectionId: section.id,
    kind: 'passage',
    source: 'ai_generated',
    title: section.passageTitle ?? null,
    text: section.passageText ?? null,
  };
}

/**
 * Ref ligera (con preview) desde un estímulo hidratado. La usa el generador anclado
 * para persistir `content.stimuli = [ref]` sin guardar el texto completo (que se
 * re-hidrata on-read desde `instrument_sections`).
 */
export function stimulusToRef(stimulus: RemedialStimulus): RemedialStimulusRef {
  return {
    sectionId: stimulus.sectionId,
    kind: stimulus.kind,
    source: stimulus.source,
    title: stimulus.title,
    textPreview: stimulusTextPreview(stimulus.text),
  };
}
