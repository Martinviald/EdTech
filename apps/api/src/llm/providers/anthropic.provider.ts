import { Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER_DEFAULTS } from '../llm.constants';
import type {
  LlmCompletionRequest,
  LlmProvider,
  LlmProviderName,
} from '../llm.types';

/**
 * Integración con la API de Anthropic (Claude) sobre `@anthropic-ai/sdk`.
 *
 * Inicialización perezosa y tolerante: si falta la API key o el paquete no está
 * instalado, el provider queda inactivo (`isAvailable() === false`) en lugar de
 * tumbar el arranque de la app.
 */
// Tipo dinámico para no romper la compilación si el SDK aún no está instalado.
 
type Anthropic = import('@anthropic-ai/sdk').default;

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name: LlmProviderName = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private client: Anthropic | null = null;

  constructor() {
    this.initClient();
  }

  private initClient(): void {
    const apiKey = process.env[LLM_PROVIDER_DEFAULTS.anthropic.apiKeyEnv];
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY no definida — provider anthropic deshabilitado',
      );
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AnthropicSdk = require('@anthropic-ai/sdk') as {
        default: new (opts: { apiKey: string }) => Anthropic;
      };
      const Constructor = AnthropicSdk.default ?? AnthropicSdk;
      this.client = new (Constructor as new (opts: {
        apiKey: string;
      }) => Anthropic)({ apiKey });
    } catch (err) {
      this.logger.error(
        'No se pudo inicializar el SDK de Anthropic. Verifica @anthropic-ai/sdk.',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    if (!this.client) {
      throw new Error('Anthropic provider no está disponible');
    }

    const response = await this.client.messages.create({
      model: request.options.model,
      max_tokens: request.options.maxTokens,
      temperature: request.options.temperature,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });

    const textBlock = response.content.find(
      (b: { type: string }) => b.type === 'text',
    );
    return (textBlock as { type: 'text'; text: string } | undefined)?.text ?? '';
  }

  /**
   * Completion MULTIMODAL: la Messages API de Anthropic acepta bloques `image`
   * con `source: { type: 'base64', media_type, data }` junto al bloque `text`.
   * Sin imágenes → delega en `complete`. Tipado estructural local para no romper
   * si el SDK aún no está instalado (mismo patrón tolerante).
   */
  async completeMultimodal(request: LlmCompletionRequest): Promise<string> {
    if (!this.client) {
      throw new Error('Anthropic provider no está disponible');
    }

    const images = request.images ?? [];
    if (images.length === 0) {
      return this.complete(request);
    }

    const content = [
      { type: 'text', text: request.prompt },
      ...images.map((img) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType,
          data: img.data,
        },
      })),
    ];

    // El cliente está tipado por el SDK; el array `content` mixto es válido en la
    // API real pero su unión exacta varía por versión → narrowing local.
    const client = this.client as unknown as {
      messages: {
        create(req: unknown): Promise<{ content: Array<{ type: string }> }>;
      };
    };
    const response = await client.messages.create({
      model: request.options.model,
      max_tokens: request.options.maxTokens,
      temperature: request.options.temperature,
      system: request.system,
      messages: [{ role: 'user', content }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return (textBlock as { type: 'text'; text: string } | undefined)?.text ?? '';
  }
}
