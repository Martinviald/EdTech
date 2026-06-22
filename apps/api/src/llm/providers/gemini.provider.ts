import { Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER_DEFAULTS } from '../llm.constants';
import type {
  LlmAgentContent,
  LlmAgentEvent,
  LlmAgentRequest,
  LlmAgentStopReason,
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
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
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

// ── Tipado estructural mínimo del streaming + function calling de @google/genai ──
// Se define localmente (en vez de importar tipos del SDK) para tolerar variaciones
// de versión del paquete — mismo patrón tolerante del resto del provider.
/** Una function call detectada en un chunk del stream (Gemini empareja por nombre). */
interface GeminiFunctionCall {
  name?: string;
  args?: Record<string, unknown>;
}
/** Una function response (resultado de tool) reinyectada al historial. */
interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}
/** Una "part" de contenido en el historial agéntico de Gemini. */
type GeminiAgentPart =
  | { text: string }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: GeminiFunctionResponse };
/** Un mensaje del historial: rol 'user' o 'model' (Gemini NO usa 'assistant'). */
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiAgentPart[];
}
/**
 * Una declaración de función expuesta al modelo (equivalente a una tool).
 * `parameters` es OPCIONAL a propósito: Gemini rechaza (400 INVALID_ARGUMENT) una
 * función cuyo `parameters` es `{ type: 'object', properties: {} }` (objeto sin
 * propiedades). Para tools sin argumentos, se OMITE `parameters` por completo.
 */
interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}
/** Chunk emitido por `generateContentStream` (forma mínima que consumimos). */
interface GeminiStreamChunk {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string; functionCall?: GeminiFunctionCall }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
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
      this.logger.warn('GEMINI_API_KEY no definida — provider gemini deshabilitado');
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

  /**
   * Vuelta agéntica con tool-use y STREAMING sobre `generateContentStream`.
   * Traduce el contrato agnóstico a la forma de Gemini:
   *  - `LlmToolDefinition.inputSchema` → `tools[].functionDeclarations[].parameters`
   *  - historial `messages` → `contents` con roles 'user'/'model' (no 'assistant')
   *  - parts `functionCall`/`functionResponse` → eventos `LlmAgentEvent`
   *
   * Diferencias clave con Anthropic:
   *  - Gemini empareja la respuesta de una función por NOMBRE, no por id. Nuestro
   *    `tool_result` solo trae `toolCallId`, así que primero construimos un mapa
   *    `id → name` recorriendo los `tool_use` del historial para resolver el nombre.
   *  - Gemini no entrega un id de tool-call; generamos uno determinista al emitir
   *    el evento (`${name}-${indiceDeLlamada}`) para que el loop lo referencie.
   */
  async *streamWithTools(request: LlmAgentRequest): AsyncIterable<LlmAgentEvent> {
    if (!this.client) {
      throw new Error('Gemini provider no está disponible');
    }

    const functionDeclarations: GeminiFunctionDeclaration[] = request.tools.map((t) => {
      const parameters = this.toGeminiParameters(t.inputSchema);
      return parameters
        ? { name: t.name, description: t.description, parameters }
        : { name: t.name, description: t.description };
    });

    // Mapa id → name de las tools invocadas en el historial: Gemini necesita el
    // NOMBRE de la función al reinyectar su resultado (`functionResponse.name`),
    // pero nuestro `tool_result` solo trae el `toolCallId`.
    const toolNameById = this.buildToolNameMap(request.messages);
    const contents: GeminiContent[] = request.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: this.toGeminiParts(m.content, toolNameById),
    }));

    // Narrowing local: la firma exacta de `generateContentStream` varía por
    // versión del SDK; tipamos solo lo que consumimos.
    const client = this.client as unknown as {
      models: {
        generateContentStream(req: {
          model: string;
          contents: GeminiContent[];
          config?: {
            systemInstruction?: string;
            tools?: Array<{
              functionDeclarations: GeminiFunctionDeclaration[];
            }>;
            maxOutputTokens?: number;
            temperature?: number;
          };
        }): Promise<AsyncIterable<GeminiStreamChunk>>;
      };
    };

    const stream = await client.models.generateContentStream({
      model: request.options.model,
      contents,
      config: {
        systemInstruction: request.system,
        tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
        maxOutputTokens: request.options.maxTokens,
        temperature: request.options.temperature,
      },
    });

    // Contador de llamadas a tools en esta vuelta: alimenta el id determinista.
    let callIndex = 0;
    // ¿Hubo alguna function call? Determina el stop reason 'tool_use' al cerrar.
    let sawFunctionCall = false;
    // Último finishReason visto (Gemini lo entrega en el último chunk).
    let finishReason: string | undefined;

    for await (const chunk of stream) {
      // Recorremos las parts del primer candidate: cada chunk trae texto
      // incremental y/o function calls desperdigadas en `content.parts`.
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          yield { type: 'text_delta', text: part.text };
        } else if (part.functionCall) {
          sawFunctionCall = true;
          yield {
            type: 'tool_call',
            id: `${part.functionCall.name ?? 'tool'}-${callIndex++}`,
            name: part.functionCall.name ?? '',
            input: part.functionCall.args ?? {},
          };
        }
      }

      // Uso de tokens: Gemini lo reporta acumulado en `usageMetadata`.
      if (chunk.usageMetadata) {
        yield {
          type: 'usage',
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
        };
      }

      const reason = chunk.candidates?.[0]?.finishReason;
      if (reason) {
        finishReason = reason;
      }
    }

    yield {
      type: 'done',
      stopReason: this.toStopReason(finishReason, sawFunctionCall),
    };
  }

  /**
   * Traduce el `inputSchema` de una tool al `parameters` de Gemini. Devuelve
   * `undefined` cuando la tool NO tiene propiedades (objeto vacío o sin
   * `properties`): Gemini exige omitir `parameters` para funciones sin argumentos
   * — un `{ type: 'object', properties: {} }` provoca un 400 INVALID_ARGUMENT que
   * tumba TODA la request (todas las tools van juntas). Anthropic sí lo acepta.
   */
  private toGeminiParameters(
    inputSchema: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const properties = inputSchema?.properties;
    const hasProps =
      properties !== null &&
      typeof properties === 'object' &&
      Object.keys(properties as Record<string, unknown>).length > 0;
    return hasProps ? inputSchema : undefined;
  }

  /**
   * Recorre el historial y construye un mapa `idDelToolUse → nombreDeLaFunción`.
   * Necesario porque al reinyectar un `tool_result`, Gemini empareja por nombre
   * (`functionResponse.name`) y nuestro bloque solo conoce el `toolCallId`.
   */
  private buildToolNameMap(messages: LlmAgentRequest['messages']): Map<string, string> {
    const map = new Map<string, string>();
    for (const message of messages) {
      for (const block of message.content) {
        if (block.type === 'tool_use') {
          map.set(block.id, block.name);
        }
      }
    }
    return map;
  }

  /** Traduce los bloques del historial agnóstico a parts de Gemini. */
  private toGeminiParts(
    content: LlmAgentContent[],
    toolNameById: Map<string, string>,
  ): GeminiAgentPart[] {
    return content.map((block) => {
      switch (block.type) {
        case 'text':
          return { text: block.text };
        case 'tool_use':
          return {
            functionCall: { name: block.name, args: block.input },
          };
        case 'tool_result':
          return {
            functionResponse: {
              // Resolvemos el nombre por id; si falta, usamos el propio id como
              // fallback defensivo (el modelo aún puede emparejar si coincide).
              name: toolNameById.get(block.toolCallId) ?? block.toolCallId,
              response: this.parseToolResult(block.content),
            },
          };
      }
    });
  }

  /**
   * Parsea el contenido serializado de un `tool_result` al objeto que Gemini
   * espera en `functionResponse.response`. Si no es un objeto JSON, lo envuelve
   * en `{ result }` para no perder el contenido ni romper el contrato del SDK.
   */
  private parseToolResult(content: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(content);
      if (parsed !== null && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return { result: parsed };
    } catch {
      return { result: content };
    }
  }

  /**
   * Mapea el `finishReason` de Gemini al stop reason agnóstico. La presencia de
   * function calls tiene prioridad: el loop debe ejecutar la tool antes de cerrar.
   */
  private toStopReason(raw: string | undefined, sawFunctionCall: boolean): LlmAgentStopReason {
    if (sawFunctionCall) {
      return 'tool_use';
    }
    switch (raw) {
      case 'STOP':
        return 'end_turn';
      case 'MAX_TOKENS':
        return 'max_tokens';
      default:
        return 'other';
    }
  }
}
