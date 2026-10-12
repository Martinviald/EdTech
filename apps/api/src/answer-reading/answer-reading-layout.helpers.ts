import type { LayoutField, ResponseFormatKind } from '@soe/types';
import { VISION_READING_FORMAT_KINDS } from './answer-reading.constants';

export type VisionFieldResponse = NonNullable<LayoutField['response']>;

export function visionResponsesByField(
  fields: readonly LayoutField[],
  kinds: readonly ResponseFormatKind[] = VISION_READING_FORMAT_KINDS,
): Map<string, VisionFieldResponse> {
  const allowedKinds: ReadonlySet<string> = new Set(kinds);
  const responses = new Map<string, VisionFieldResponse>();
  for (const field of fields) {
    if (field.kind !== 'crop_region' || field.response === undefined) continue;
    if (!allowedKinds.has(field.response.format.kind)) continue;
    responses.set(field.fieldId, field.response);
  }
  return responses;
}
