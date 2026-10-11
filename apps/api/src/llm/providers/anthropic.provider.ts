import { Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER_DEFAULTS } from '../llm.constants';
import type {
  LlmAgentContent,
  LlmAgentEvent,
  LlmAgentRequest,
  LlmAgentStopReason,
  LlmCompletionOptions,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
  LlmProviderName,
  LlmStructuredFinishReason,
  LlmStructuredRequest,
  LlmStructuredResult,
  LlmStructuredUsage,
} from '../llm.types';

// ── Tipado estructural mínimo de los eventos de streaming de la Messages API ──
// Se define localmente (en vez de importar tipos del SDK) para tolerar variaciones
// de versión del paquete — mismo patrón que el resto del provider.
interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
}

interface AnthropicMessageResponse {
  id?: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

type AnthropicStructuredClient = {
  messages: {
    create(
      req: Record<string, unknown>,
      options?: { timeout?: number },
    ): Promise<AnthropicMessageResponse>;
  };
};

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
    return (await this.completeWithUsage(request)).text;
  }

  async completeWithUsage(
    request: LlmCompletionRequest,
  ): Promise<LlmCompletionResult> {
    return this.createMessage(request, request.prompt);
  }

  async completeMultimodal(request: LlmCompletionRequest): Promise<string> {
    return (await this.completeMultimodalWithUsage(request)).text;
  }

  async completeMultimodalWithUsage(
    request: LlmCompletionRequest,
  ): Promise<LlmCompletionResult> {
    const images = request.images ?? [];
    if (images.length === 0) {
      return this.completeWithUsage(request);
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
    return this.createMessage(request, content);
  }

  private async createMessage(
    request: LlmCompletionRequest,
    content: unknown,
  ): Promise<LlmCompletionResult> {
    if (!this.client) {
      throw new Error('Anthropic provider no está disponible');
    }

    const client = this.client as unknown as {
      messages: {
        create(req: unknown): Promise<AnthropicMessageResponse>;
      };
    };
    const response = await client.messages.create({
      model: request.options.model,
      max_tokens: request.options.maxTokens,
      ...this.samplingParams(request.options),
      system: request.system,
      messages: [{ role: 'user', content }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return {
      text: textBlock?.text ?? '',
      model: request.options.model,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens ?? 0,
            outputTokens: response.usage.output_tokens ?? 0,
          }
        : null,
    };
  }

  async completeStructured(request: LlmStructuredRequest): Promise<LlmStructuredResult> {
    if (!this.client) {
      throw new Error('Anthropic provider no está disponible');
    }

    const client = this.client as unknown as AnthropicStructuredClient;
    const response = await client.messages.create(
      {
        model: request.options.model,
        max_tokens: request.options.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: this.structuredContent(request) }],
        ...this.reasoningParams(request),
      },
      { timeout: request.options.timeoutMs },
    );

    const rawText = response.content.find((b) => b.type === 'text')?.text ?? '';
    return {
      data: this.parseStructuredText(rawText),
      rawText,
      model: request.options.model,
      finishReason: this.toStructuredFinishReason(response.stop_reason),
      usage: this.toStructuredUsage(response.usage),
      providerRequestId: response.id ?? null,
    };
  }

  private structuredContent(request: LlmStructuredRequest): unknown[] {
    return [
      ...request.images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.data },
      })),
      { type: 'text', text: request.prompt },
    ];
  }

  private reasoningParams(request: LlmStructuredRequest): Record<string, unknown> {
    const format = { type: 'json_schema', schema: request.jsonSchema };
    if (request.options.reasoning === 'off') {
      return { thinking: { type: 'disabled' }, output_config: { format } };
    }
    return {
      thinking: { type: 'adaptive' },
      output_config: { format, effort: request.options.reasoning },
    };
  }

  private parseStructuredText(rawText: string): unknown {
    try {
      return JSON.parse(rawText);
    } catch {
      return null;
    }
  }

  private toStructuredFinishReason(
    stopReason: string | null | undefined,
  ): LlmStructuredFinishReason {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'max_tokens';
      case 'refusal':
        return 'refusal';
      default:
        return 'other';
    }
  }

  private toStructuredUsage(usage: AnthropicMessageResponse['usage']): LlmStructuredUsage | null {
    if (!usage) return null;
    const cachedInputTokens = usage.cache_read_input_tokens ?? 0;
    return {
      inputTokens:
        (usage.input_tokens ?? 0) + cachedInputTokens + (usage.cache_creation_input_tokens ?? 0),
      outputTokens: usage.output_tokens ?? 0,
      reasoningTokens: 0,
      cachedInputTokens,
      imageTokens: null,
    };
  }

  private samplingParams(
    options: LlmCompletionOptions,
  ): { temperature: number } | Record<string, never> {
    return options.temperature !== undefined
      ? { temperature: options.temperature }
      : {};
  }

  /**
   * Vuelta agéntica con tool-use y STREAMING sobre la Messages API
   * (`stream: true`). Traduce el contrato agnóstico a la forma de Anthropic:
   *  - `LlmToolDefinition.inputSchema` → `tools[].input_schema`
   *  - bloques `tool_use`/`tool_result` del historial → bloques nativos
   *  - eventos `content_block_*`/`message_delta` → `LlmAgentEvent`
   *
   * El input de cada tool llega fragmentado (`input_json_delta`); se acumula y
   * se parsea al cerrar el bloque (`content_block_stop`).
   */
  async *streamWithTools(
    request: LlmAgentRequest,
  ): AsyncIterable<LlmAgentEvent> {
    if (!this.client) {
      throw new Error('Anthropic provider no está disponible');
    }

    const tools = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: this.toAnthropicContent(m.content),
    }));

    // Narrowing local: el array de bloques mixtos es válido en la API real pero
    // su unión exacta varía por versión del SDK.
    const client = this.client as unknown as {
      messages: {
        create(req: unknown): Promise<AsyncIterable<AnthropicStreamEvent>>;
      };
    };
    const stream = await client.messages.create({
      model: request.options.model,
      max_tokens: request.options.maxTokens,
      ...this.samplingParams(request.options),
      system: request.system,
      tools,
      messages,
      stream: true,
    });

    let pendingTool: { id: string; name: string; json: string } | null = null;

    for await (const event of stream) {
      switch (event.type) {
        case 'message_start':
          if (event.message?.usage) {
            yield {
              type: 'usage',
              inputTokens: event.message.usage.input_tokens ?? 0,
              outputTokens: event.message.usage.output_tokens ?? 0,
            };
          }
          break;
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            pendingTool = {
              id: event.content_block.id ?? '',
              name: event.content_block.name ?? '',
              json: '',
            };
          }
          break;
        case 'content_block_delta':
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            yield { type: 'text_delta', text: event.delta.text };
          } else if (
            event.delta?.type === 'input_json_delta' &&
            pendingTool &&
            event.delta.partial_json
          ) {
            pendingTool.json += event.delta.partial_json;
          }
          break;
        case 'content_block_stop':
          if (pendingTool) {
            yield {
              type: 'tool_call',
              id: pendingTool.id,
              name: pendingTool.name,
              input: this.parseToolInput(pendingTool.json),
            };
            pendingTool = null;
          }
          break;
        case 'message_delta':
          if (event.usage?.output_tokens) {
            yield {
              type: 'usage',
              inputTokens: 0,
              outputTokens: event.usage.output_tokens,
            };
          }
          if (event.delta?.stop_reason) {
            yield {
              type: 'done',
              stopReason: this.toStopReason(event.delta.stop_reason),
            };
          }
          break;
        default:
          break;
      }
    }
  }

  /** Traduce los bloques del historial agnóstico a bloques de la Messages API. */
  private toAnthropicContent(content: LlmAgentContent[]): unknown[] {
    return content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'tool_use':
          return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.toolCallId,
            content: block.content,
            is_error: block.isError ?? false,
          };
      }
    });
  }

  /** Parsea el input acumulado de una tool; `{}` si viene vacío o malformado. */
  private parseToolInput(json: string): unknown {
    const trimmed = json.trim();
    if (trimmed.length === 0) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      this.logger.warn(`No se pudo parsear el input de tool: ${trimmed}`);
      return {};
    }
  }

  private toStopReason(raw: string): LlmAgentStopReason {
    switch (raw) {
      case 'end_turn':
        return 'end_turn';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      default:
        return 'other';
    }
  }
}
