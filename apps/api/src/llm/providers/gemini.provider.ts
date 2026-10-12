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
  LlmMediaResolution,
  LlmProvider,
  LlmProviderName,
  LlmReasoningLevel,
  LlmStructuredFinishReason,
  LlmStructuredRequest,
  LlmStructuredResult,
  LlmStructuredUsage,
  LlmUsage,
} from '../llm.types';

type GeminiThinkingConfig = { thinkingBudget: number } | { thinkingLevel: string };

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
}

interface GeminiStructuredResponse {
  responseId?: string;
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: GeminiUsageMetadata;
}

type GeminiStructuredClient = {
  models: {
    generateContent(req: {
      model: string;
      contents: GeminiPart[];
      config: Record<string, unknown>;
    }): Promise<GeminiStructuredResponse>;
  };
};

const GEMINI_MEDIA_RESOLUTION: Record<LlmMediaResolution, string> = {
  low: 'MEDIA_RESOLUTION_LOW',
  medium: 'MEDIA_RESOLUTION_MEDIUM',
  high: 'MEDIA_RESOLUTION_HIGH',
};

const GEMINI_THINKING_BUDGET: Record<Exclude<LlmReasoningLevel, 'off'>, number> = {
  low: 1024,
  medium: 8192,
};

const GEMINI_PRO_MIN_THINKING_BUDGET = 128;

const GEMINI_OFF_THINKING_LEVELS = ['MINIMAL', 'LOW'] as const;

const BAD_REQUEST_STATUS = 400;

const THINKING_LEVEL_REJECTION = /thinking level \w+ is not supported/i;

const GEMINI_MAX_THINKING_SHARE = 0.5;

const GEMINI_SAFETY_FINISH_REASONS = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
]);

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
/** Config de una completion no conversacional (compartida por complete/multimodal). */
type GeminiCompletionConfig = {
  systemInstruction?: string;
  maxOutputTokens?: number;
  temperature?: number;
  responseMimeType?: string;
  thinkingConfig?: { thinkingBudget?: number };
};
interface GeminiClient {
  readonly models: {
    generateContent(req: {
      model: string;
      contents: string | GeminiPart[];
      config?: {
        systemInstruction?: string;
        maxOutputTokens?: number;
        temperature?: number;
        /** MIME de la respuesta. `application/json` activa el JSON mode nativo. */
        responseMimeType?: string;
        /**
         * Control del razonamiento interno ("thinking") de los modelos 2.5+.
         * `thinkingBudget: 0` lo desactiva: en salida estructurada el thinking
         * consume `maxOutputTokens` (visto: 3928/4096) y trunca el JSON.
         */
        thinkingConfig?: { thinkingBudget?: number };
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
  | { functionCall: { name: string; args: unknown }; thoughtSignature?: string }
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
      parts?: Array<{
        text?: string;
        functionCall?: GeminiFunctionCall;
        thoughtSignature?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

const GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  '$schema',
  'additionalProperties',
]);

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name: LlmProviderName = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private client: GeminiClient | null = null;
  private readonly offThinkingStepByModel = new Map<string, number>();

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

  /**
   * Config de "thinking" según el modelo. Quirk de Gemini 2.5:
   *  - Modelos **Pro** EXIGEN thinking (`thinkingBudget: 0` → 400). Se omite la
   *    config para dejar el thinking activo; el budget de salida debe ser holgado
   *    (ver `analysisMaxTokens`) porque el thinking consume tokens.
   *  - El resto (Flash) lo DESACTIVAMOS: en salida estructurada el thinking
   *    agotaba `maxOutputTokens` y truncaba el JSON (finishReason MAX_TOKENS).
   * Devuelve `undefined` cuando no hay que enviar `thinkingConfig`.
   */
  private thinkingConfigFor(model: string): { thinkingBudget: number } | undefined {
    return /pro/i.test(model) ? undefined : { thinkingBudget: 0 };
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    return (await this.completeWithUsage(request)).text;
  }

  async completeWithUsage(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.client) {
      throw new Error('Gemini provider no está disponible');
    }

    const { text, usage } = await this.streamToResult({
      model: request.options.model,
      contents: request.prompt,
      config: this.completionConfig(request),
    });
    return { text, model: request.options.model, usage };
  }

  /**
   * Config compartida de las completions `complete`/`completeMultimodal`.
   * JSON mode nativo: todos los consumidores (ai-analysis, item-insight, remedial,
   * ai-tagging) parsean con `JSON.parse`; `application/json` evita prosa alrededor.
   * Thinking según modelo (`thinkingConfigFor`): off en Flash (no truncar el JSON),
   * activo (omitido) en Pro, que lo exige.
   */
  private completionConfig(request: LlmCompletionRequest): GeminiCompletionConfig {
    const thinking = this.thinkingConfigFor(request.options.model);
    return {
      systemInstruction: request.system,
      maxOutputTokens: request.options.maxTokens,
      ...this.samplingParams(request.options),
      responseMimeType: 'application/json',
      ...(thinking ? { thinkingConfig: thinking } : {}),
    };
  }

  /**
   * Ejecuta una completion (NO conversacional) sobre el endpoint de STREAMING
   * (`generateContentStream`) y ACUMULA el texto de los chunks. Devuelve el mismo
   * string completo que `generateContent`, pero la conexión recibe datos de forma
   * continua en vez de quedar idle esperando toda la respuesta. Esto evita que un
   * idle-timeout de la ruta de egress (visto en AWS: ~60s → `fetch failed` en
   * informes largos) resetee la conexión. El asistente ya funcionaba por esta
   * misma razón (usa streaming); el caller sigue recibiendo el JSON completo.
   */
  private async streamToResult(req: {
    model: string;
    contents: string | GeminiPart[];
    config: GeminiCompletionConfig;
  }): Promise<{ text: string; usage: LlmUsage | null }> {
    const client = this.client as unknown as {
      models: {
        generateContentStream(r: {
          model: string;
          contents: string | GeminiPart[];
          config?: GeminiCompletionConfig;
        }): Promise<AsyncIterable<GeminiStreamChunk>>;
      };
    };

    const stream = await client.models.generateContentStream(req);
    let text = '';
    // Gemini reporta el uso ACUMULADO en `usageMetadata`; nos quedamos con el
    // último chunk que lo trae (el total del turno). Mismo criterio que la ruta
    // agéntica (`streamWithTools`).
    let usage: LlmUsage | null = null;
    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === 'string') text += part.text;
      }
      if (chunk.usageMetadata) {
        usage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens:
            (chunk.usageMetadata.candidatesTokenCount ?? 0) +
            (chunk.usageMetadata.thoughtsTokenCount ?? 0),
        };
      }
    }
    return { text, usage };
  }

  async completeStructured(request: LlmStructuredRequest): Promise<LlmStructuredResult> {
    if (!this.client) {
      throw new Error('Gemini provider no está disponible');
    }

    const client = this.client as unknown as GeminiStructuredClient;
    const response = await this.generateWithThinking(client, request);

    const candidate = response.candidates?.[0];
    const rawText = (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    return {
      data: this.parseStructuredText(rawText),
      rawText,
      model: request.options.model,
      providerModel: response.modelVersion || request.options.model,
      finishReason: this.toStructuredFinishReason(response),
      usage: this.toStructuredUsage(response.usageMetadata),
      providerRequestId: response.responseId ?? null,
    };
  }

  private async generateWithThinking(
    client: GeminiStructuredClient,
    request: LlmStructuredRequest,
  ): Promise<GeminiStructuredResponse> {
    const { model, reasoning, maxTokens } = request.options;
    if (!this.usesOffThinkingLevels(model, reasoning)) {
      return this.generateStructured(
        client,
        request,
        this.structuredThinkingConfig(model, reasoning, maxTokens),
      );
    }
    let step = this.offThinkingStepByModel.get(model) ?? 0;
    for (;;) {
      const thinkingLevel = GEMINI_OFF_THINKING_LEVELS[step] ?? 'LOW';
      try {
        const response = await this.generateStructured(client, request, { thinkingLevel });
        this.offThinkingStepByModel.set(model, step);
        return response;
      } catch (error) {
        if (
          step + 1 >= GEMINI_OFF_THINKING_LEVELS.length ||
          !this.isThinkingLevelRejection(error)
        ) {
          throw error;
        }
        this.logger.warn(
          `El modelo ${model} rechazó thinkingLevel=${thinkingLevel}; se reintenta con el siguiente nivel`,
        );
        step += 1;
      }
    }
  }

  private usesOffThinkingLevels(model: string, reasoning: LlmReasoningLevel): boolean {
    return reasoning === 'off' && /^gemini-[3-9]/i.test(model) && !/pro/i.test(model);
  }

  private generateStructured(
    client: GeminiStructuredClient,
    request: LlmStructuredRequest,
    thinkingConfig: GeminiThinkingConfig | undefined,
  ): Promise<GeminiStructuredResponse> {
    return client.models.generateContent({
      model: request.options.model,
      contents: [
        ...request.images.map((img) => ({
          inlineData: { mimeType: img.mimeType, data: img.data },
        })),
        { text: request.prompt },
      ],
      config: this.structuredConfig(request, thinkingConfig),
    });
  }

  private isThinkingLevelRejection(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const { status } = error as Error & { status?: unknown };
    return status === BAD_REQUEST_STATUS && THINKING_LEVEL_REJECTION.test(error.message);
  }

  private samplingParams(options: LlmCompletionOptions): { temperature?: number } {
    return options.temperature !== undefined ? { temperature: options.temperature } : {};
  }

  private structuredConfig(
    request: LlmStructuredRequest,
    thinkingConfig: GeminiThinkingConfig | undefined,
  ): Record<string, unknown> {
    return {
      systemInstruction: request.system,
      maxOutputTokens: request.options.maxTokens,
      responseMimeType: 'application/json',
      responseJsonSchema: request.jsonSchema,
      httpOptions: { timeout: request.options.timeoutMs },
      ...(request.options.mediaResolution
        ? { mediaResolution: GEMINI_MEDIA_RESOLUTION[request.options.mediaResolution] }
        : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    };
  }

  private structuredThinkingConfig(
    model: string,
    reasoning: LlmReasoningLevel,
    maxTokens: number,
  ): GeminiThinkingConfig | undefined {
    const isPro = /pro/i.test(model);
    if (/^gemini-2\.5/i.test(model)) {
      const minBudget = isPro ? GEMINI_PRO_MIN_THINKING_BUDGET : 0;
      if (reasoning === 'off') return { thinkingBudget: minBudget };
      const budget = Math.min(
        GEMINI_THINKING_BUDGET[reasoning],
        Math.floor(maxTokens * GEMINI_MAX_THINKING_SHARE),
      );
      return { thinkingBudget: Math.max(budget, minBudget) };
    }
    if (/^gemini-[3-9]/i.test(model)) {
      if (reasoning === 'off') return { thinkingLevel: isPro ? 'LOW' : 'MINIMAL' };
      return { thinkingLevel: reasoning.toUpperCase() };
    }
    return undefined;
  }

  private parseStructuredText(rawText: string): unknown {
    try {
      return JSON.parse(rawText);
    } catch {
      return null;
    }
  }

  private toStructuredFinishReason(response: GeminiStructuredResponse): LlmStructuredFinishReason {
    if (response.promptFeedback?.blockReason) return 'safety';
    const reason = response.candidates?.[0]?.finishReason;
    if (reason === 'STOP') return 'stop';
    if (reason === 'MAX_TOKENS') return 'max_tokens';
    if (reason !== undefined && GEMINI_SAFETY_FINISH_REASONS.has(reason)) return 'safety';
    return 'other';
  }

  private toStructuredUsage(metadata: GeminiUsageMetadata | undefined): LlmStructuredUsage | null {
    if (!metadata) return null;
    const reasoningTokens = metadata.thoughtsTokenCount ?? 0;
    const imageDetails = (metadata.promptTokensDetails ?? []).filter(
      (detail) => detail.modality === 'IMAGE',
    );
    return {
      inputTokens: metadata.promptTokenCount ?? 0,
      outputTokens: (metadata.candidatesTokenCount ?? 0) + reasoningTokens,
      reasoningTokens,
      cachedInputTokens: metadata.cachedContentTokenCount ?? 0,
      imageTokens:
        metadata.promptTokensDetails === undefined
          ? null
          : imageDetails.reduce((sum, detail) => sum + (detail.tokenCount ?? 0), 0),
    };
  }

  /**
   * Completion MULTIMODAL: envía el prompt + imágenes en línea (`inlineData`).
   * `@google/genai` acepta `contents` como array de parts:
   * `[{ text }, { inlineData: { mimeType, data } }, …]`. Si no llegan imágenes,
   * delega en `complete` (solo texto) — mismo patrón tolerante al SDK ausente.
   */
  async completeMultimodal(request: LlmCompletionRequest): Promise<string> {
    return (await this.completeMultimodalWithUsage(request)).text;
  }

  async completeMultimodalWithUsage(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.client) {
      throw new Error('Gemini provider no está disponible');
    }

    const images = request.images ?? [];
    if (images.length === 0) {
      return this.completeWithUsage(request);
    }

    const parts: GeminiPart[] = [
      { text: request.prompt },
      ...images.map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.data },
      })),
    ];

    // Mismo streaming-acumulado que `complete` (ver `streamToResult`): el único
    // caller multimodal (item-insight con imágenes) también parsea JSON.
    const { text, usage } = await this.streamToResult({
      model: request.options.model,
      contents: parts,
      config: this.completionConfig(request),
    });
    return { text, model: request.options.model, usage };
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
        ...this.samplingParams(request.options),
      },
    });

    // Contador de llamadas a tools en esta vuelta: alimenta el id determinista.
    let callIndex = 0;
    // ¿Hubo alguna function call? Determina el stop reason 'tool_use' al cerrar.
    let sawFunctionCall = false;
    // Último finishReason visto (Gemini lo entrega en el último chunk).
    let finishReason: string | undefined;
    let lastUsage: GeminiStreamChunk['usageMetadata'];

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
            ...(part.thoughtSignature
              ? { providerMetadata: { thoughtSignature: part.thoughtSignature } }
              : {}),
          };
        }
      }

      if (chunk.usageMetadata) {
        lastUsage = chunk.usageMetadata;
      }

      const reason = chunk.candidates?.[0]?.finishReason;
      if (reason) {
        finishReason = reason;
      }
    }

    if (lastUsage) {
      yield {
        type: 'usage',
        inputTokens: lastUsage.promptTokenCount ?? 0,
        outputTokens: (lastUsage.candidatesTokenCount ?? 0) + (lastUsage.thoughtsTokenCount ?? 0),
      };
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
    return hasProps ? this.withoutUnsupportedKeywords(inputSchema) : undefined;
  }

  private withoutUnsupportedKeywords(schema: Record<string, unknown>): Record<string, unknown> {
    const supported: Record<string, unknown> = {};
    for (const [keyword, value] of Object.entries(schema)) {
      if (GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS.has(keyword)) continue;
      supported[keyword] =
        keyword === 'properties' && this.isSchemaObject(value)
          ? this.mapSchemaValues(value)
          : this.cleanSchemaNode(value);
    }
    return supported;
  }

  private mapSchemaValues(properties: Record<string, unknown>): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const [name, propertySchema] of Object.entries(properties)) {
      mapped[name] = this.cleanSchemaNode(propertySchema);
    }
    return mapped;
  }

  private cleanSchemaNode(node: unknown): unknown {
    if (Array.isArray(node)) return node.map((entry) => this.cleanSchemaNode(entry));
    return this.isSchemaObject(node) ? this.withoutUnsupportedKeywords(node) : node;
  }

  private isSchemaObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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
          return this.toFunctionCallPart(block);
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

  private toFunctionCallPart(
    block: Extract<LlmAgentContent, { type: 'tool_use' }>,
  ): GeminiAgentPart {
    const thoughtSignature = block.providerMetadata?.thoughtSignature;
    return {
      functionCall: { name: block.name, args: block.input },
      ...(typeof thoughtSignature === 'string' ? { thoughtSignature } : {}),
    };
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
