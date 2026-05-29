import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { LlmConfigService } from './llm.config';
import { LLM_PROVIDERS } from './llm.constants';
import type { LlmProvider, LlmProviderName } from './llm.types';

/**
 * Fachada provider-agnóstica para inferencia LLM.
 *
 * Resuelve la configuración activa (`LlmConfigService`), selecciona el provider
 * correspondiente del registry y delega la llamada. Los consumidores nunca
 * conocen el SDK concreto ni el modelo: solo invocan `complete()`.
 */
@Injectable()
export class LlmService {
  private readonly registry: Map<LlmProviderName, LlmProvider>;

  constructor(
    private readonly config: LlmConfigService,
    @Inject(LLM_PROVIDERS) providers: LlmProvider[],
  ) {
    this.registry = new Map(providers.map((p) => [p.name, p]));
  }

  /**
   * Indica si el proveedor activo está listo (credenciales + SDK).
   * @param orgId tenant para resolución de config por organización (F2+).
   */
  async isAvailable(orgId?: string | null): Promise<boolean> {
    const cfg = await this.config.resolve(orgId);
    return this.registry.get(cfg.provider)?.isAvailable() ?? false;
  }

  /**
   * Ejecuta una completion contra el proveedor/modelo activos.
   *
   * @param system instrucción de sistema.
   * @param prompt prompt del usuario.
   * @param orgId  tenant para resolución de config por organización (F2+).
   * @returns texto plano de la respuesta del modelo.
   */
  async complete(
    system: string,
    prompt: string,
    orgId?: string | null,
  ): Promise<string> {
    const cfg = await this.config.resolve(orgId);
    const provider = this.registry.get(cfg.provider);

    if (!provider) {
      throw new ServiceUnavailableException(
        `LLM provider "${cfg.provider}" no está registrado`,
      );
    }
    if (!provider.isAvailable()) {
      throw new ServiceUnavailableException(
        `LLM provider "${cfg.provider}" no está disponible — revisa su API key`,
      );
    }

    return provider.complete({
      system,
      prompt,
      options: {
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        temperature: cfg.temperature,
      },
    });
  }
}
