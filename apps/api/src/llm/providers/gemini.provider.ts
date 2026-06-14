import { Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER_DEFAULTS } from '../llm.constants';
import type {
  LlmCompletionRequest,
  LlmProvider,
  LlmProviderName,
} from '../llm.types';

/**
 * Integración con la API de Google Gemini sobre `@google/genai`.
 *
 * Sigue exactamente el mismo contrato y patrón que `AnthropicProvider`:
 * inicialización perezosa y tolerante a la ausencia de la API key o del SDK.
 *
 * Instalar el SDK: `pnpm --filter @soe/api add @google/genai`.
 */
/**
 * Tipado estructural mínimo del SDK `@google/genai`.
 *
 * Se define localmente (en vez de `import('@google/genai')`) para que el módulo
 * compile aunque el paquete aún no esté instalado — igual que el patrón
 * tolerante de `AnthropicProvider`. La forma coincide con la API real:
 * `new GoogleGenAI({ apiKey }).models.generateContent(...)`.
 */
interface GenerateContentResponse {
  readonly text?: string;
}
/**
 * Una "part" del contenido multimodal de Gemini: texto o binario en línea.
 * La API real acepta `contents` como string (solo texto) o como array de parts.
 */
type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };
interface GeminiClient {
  readonly models: {
    generateContent(req: {
      model: string;
      contents: string | GeminiPart[];
      config?: {
        systemInstruction?: string;
        maxOutputTokens?: number;
        temperature?: number;
      };
    }): Promise<GenerateContentResponse>;
  };
}

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name: LlmProviderName = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private client: GeminiClient | null = null;

  constructor() {
    this.initClient();
  }

  private initClient(): void {
    const apiKey = process.env[LLM_PROVIDER_DEFAULTS.gemini.apiKeyEnv];
    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY no definida — provider gemini deshabilitado',
      );
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const GenAiSdk = require('@google/genai') as {
        GoogleGenAI: new (opts: { apiKey: string }) => GeminiClient;
      };
      this.client = new GenAiSdk.GoogleGenAI({ apiKey });
    } catch (err) {
      this.logger.error(
        'No se pudo inicializar el SDK de Google GenAI. Verifica @google/genai.',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    if (!this.client) {
      throw new Error('Gemini provider no está disponible');
    }

    const response = await this.client.models.generateContent({
      model: request.options.model,
      contents: request.prompt,
      config: {
        systemInstruction: request.system,
        maxOutputTokens: request.options.maxTokens,
        temperature: request.options.temperature,
      },
    });

    return response.text ?? '';
  }

  /**
   * Completion MULTIMODAL: envía el prompt + imágenes en línea (`inlineData`).
   * `@google/genai` acepta `contents` como array de parts:
   * `[{ text }, { inlineData: { mimeType, data } }, …]`. Si no llegan imágenes,
   * delega en `complete` (solo texto) — mismo patrón tolerante al SDK ausente.
   */
  async completeMultimodal(request: LlmCompletionRequest): Promise<string> {
    if (!this.client) {
      throw new Error('Gemini provider no está disponible');
    }

    const images = request.images ?? [];
    if (images.length === 0) {
      return this.complete(request);
    }

    const parts: GeminiPart[] = [
      { text: request.prompt },
      ...images.map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.data },
      })),
    ];

    const response = await this.client.models.generateContent({
      model: request.options.model,
      contents: parts,
      config: {
        systemInstruction: request.system,
        maxOutputTokens: request.options.maxTokens,
        temperature: request.options.temperature,
      },
    });

    return response.text ?? '';
  }
}
