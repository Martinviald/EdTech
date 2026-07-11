import { Injectable } from '@nestjs/common';
import type { RemedialStimulusRef } from '@soe/types';
import type { FailedStimulus } from './failed-stimulus.service';
import type { PassageSelectionPolicy } from './passage-selection.policy';
import { failedStimulusToRef } from './stimulus.mappers';

/**
 * Política por defecto (Ola 2.1a): elige el pasaje de MAYOR brecha, salvo override
 * explícito del docente. Devuelve una lista de 1 (multi-pasaje = política futura, sin
 * cambiar el contrato del caller).
 */
@Injectable()
export class HighestGapPolicy implements PassageSelectionPolicy {
  select(
    candidates: FailedStimulus[],
    overrideSectionId?: string,
  ): RemedialStimulusRef[] {
    if (candidates.length === 0) return [];

    if (overrideSectionId) {
      const override = candidates.find((c) => c.sectionId === overrideSectionId);
      return override ? [failedStimulusToRef(override)] : [];
    }

    // `FailedStimulusService.list` entrega los candidatos ordenados por brecha desc.
    const [top] = candidates;
    return top ? [failedStimulusToRef(top)] : [];
  }
}
