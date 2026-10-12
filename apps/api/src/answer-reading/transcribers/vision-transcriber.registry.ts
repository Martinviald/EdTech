import { Inject, Injectable } from '@nestjs/common';
import type { ReaderSpec } from '@soe/types';
import { VISION_TRANSCRIBERS, type VisionTranscriber } from './vision-transcriber';

@Injectable()
export class VisionTranscriberRegistry {
  constructor(@Inject(VISION_TRANSCRIBERS) private readonly transcribers: VisionTranscriber[]) {}

  forReader(reader: ReaderSpec): VisionTranscriber | null {
    return (
      this.transcribers.find(
        (transcriber) => transcriber.id === reader.transcriberId && transcriber.supports(reader),
      ) ?? null
    );
  }
}
