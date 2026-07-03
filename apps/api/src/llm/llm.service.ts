import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { LlmConfigService } from './llm.config';
import { LLM_PROVIDERS } from './llm.constants';
import type { LlmFeature } from '@soe/types';
import type { LlmImagePart, LlmProvider, LlmProviderName } from './llm.types';

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
   * Indica si el proveedor configurado para `feature` está listo (credenciales + SDK).
   * @param orgId   tenant para resolución de config por organización (F2+).
   * @param feature funcionalidad de IA (resuelve qué proveedor se chequea).
   */
  async isAvailable(
    orgId: string | null | undefined,
    feature: LlmFeature,
  ): Promise<boolean> {
    const cfg = await this.config.resolve(orgId, feature);
    return this.registry.get(cfg.provider)?.isAvailable() ?? false;
  }

  /**
   * Ejecuta una completion contra el proveedor/modelo activos.
   *
   * @param system  instrucción de sistema.
   * @param prompt  prompt del usuario.
   * @param orgId   tenant para resolución de config por organización (F2+).
   * @param feature funcionalidad de IA que llama (resuelve proveedor+modelo desde
   *                `llm_settings`, ver `LlmConfigService`).
   * @returns texto plano de la respuesta del modelo.
   */
  async complete(
    system: string,
    prompt: string,
    orgId: string | null | undefined,
    feature: LlmFeature,
  ): Promise<string> {
    const cfg = await this.config.resolve(orgId, feature);
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

  /**
   * Ejecuta una completion MULTIMODAL (texto + imágenes) contra el proveedor/modelo
   * activos. Degradación elegante (best-effort): si no hay imágenes o el provider
   * no implementa `completeMultimodal`, cae a `complete` (solo texto). NO cambia la
   * firma de `complete()` (la usan el runner de S1 y `ai-tagging`).
   *
   * @param system instrucción de sistema.
   * @param prompt prompt del usuario.
   * @param images  imágenes a adjuntar (base64). Vacío/undefined → solo texto.
   * @param orgId   tenant para resolución de config por organización (F2+).
   * @param feature funcionalidad de IA que llama (resuelve proveedor+modelo desde
   *                `llm_settings`, ver `LlmConfigService`).
   * @returns texto plano de la respuesta del modelo.
   */
  async completeMultimodal(
    system: string,
    prompt: string,
    images: LlmImagePart[] | undefined,
    orgId: string | null | undefined,
    feature: LlmFeature,
  ): Promise<string> {
    const cfg = await this.config.resolve(orgId, feature);
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

    const request = {
      system,
      prompt,
      images,
      options: {
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        temperature: cfg.temperature,
      },
    };

    // Sin imágenes o sin soporte multimodal → solo texto (degradación elegante).
    if (images && images.length > 0 && provider.completeMultimodal) {
      return provider.completeMultimodal(request);
    }
    return provider.complete(request);
  }
}
