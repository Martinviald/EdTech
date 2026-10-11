import type { LayoutField } from '@soe/types';
import { VISION_SHORT_ANSWER_FORMAT_KINDS } from './answer-reading.constants';

export type VisionFieldResponse = NonNullable<LayoutField['response']>;

const VISION_KINDS: ReadonlySet<string> = new Set(VISION_SHORT_ANSWER_FORMAT_KINDS);

export function visionResponsesByField(
  fields: readonly LayoutField[],
): Map<string, VisionFieldResponse> {
  const responses = new Map<string, VisionFieldResponse>();
  for (const field of fields) {
    if (field.kind !== 'crop_region' || field.response === undefined) continue;
    if (!VISION_KINDS.has(field.response.format.kind)) continue;
    responses.set(field.fieldId, field.response);
  }
  return responses;
}
