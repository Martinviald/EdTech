import { Injectable } from '@nestjs/common';
import { ACTIVE_LLM_PROVIDER, LLM_PROVIDER_DEFAULTS } from './llm.constants';
import type { LlmProviderName, LlmRuntimeConfig } from './llm.types';

/**
 * Resuelve la configuración LLM efectiva (proveedor + modelo + parámetros).
 *
 * Es el ÚNICO punto del sistema que lee la configuración estática. El método
 * `resolve()` es asíncrono a propósito: cuando la configuración migre a la
 * tabla `llm_settings` (por organización), solo cambia el cuerpo de este
 * método — la firma y todos los consumidores quedan intactos.
 *
 * Overrides puntuales por entorno (sin tocar código):
 *  - `LLM_PROVIDER`: proveedor activo (ver `llm.constants.ts`).
 *  - `LLM_MODEL`: modelo a usar dentro del proveedor activo.
 */
@Injectable()
export class LlmConfigService {
  // eslint-disable-next-line @typescript-eslint/require-await
  async resolve(orgId?: string | null): Promise<LlmRuntimeConfig> {
    // TODO(F2): si existe configuración en `llm_settings` para `orgId`,
    // devolverla aquí. Hoy `orgId` no se usa; se mantiene en la firma para que
    // los consumidores ya pasen el tenant y la migración no los afecte.
    void orgId;

    const provider: LlmProviderName = ACTIVE_LLM_PROVIDER;
    const defaults = LLM_PROVIDER_DEFAULTS[provider];

    return {
      provider,
      model: process.env.LLM_MODEL || defaults.model,
      maxTokens: defaults.maxTokens,
      temperature: defaults.temperature,
    };
  }
}
