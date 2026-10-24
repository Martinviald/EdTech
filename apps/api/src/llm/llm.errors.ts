import { ServiceUnavailableException } from '@nestjs/common';
import type { LlmModelChoice } from '@soe/types';

export class LlmModelUnavailableError extends ServiceUnavailableException {
  constructor(readonly choice: LlmModelChoice) {
    super(
      `El modelo "${choice.model}" de ${choice.provider} no está en el catálogo o está deshabilitado`,
    );
  }
}
