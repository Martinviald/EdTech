import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  FunctionTool,
  Response as OpenAiResponse,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseInputContent,
  ResponseInputItem,
  ResponseStreamEvent,
  ResponseUsage,
} from 'openai/resources/responses/responses';
import type { ReasoningEffort } from 'openai/resources/shared';
import { reportServerError } from '../../common/observability/report-error';
import { LLM_PROVIDER_DEFAULTS } from '../llm.constants';
import type {
  LlmAgentContent,
  LlmAgentEvent,
  LlmAgentRequest,
  LlmAgentStopReason,
  LlmCompletionOptions,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmImagePart,
  LlmMediaResolution,
  LlmProvider,
  LlmProviderName,
  LlmStructuredFinishReason,
  LlmStructuredRequest,
  LlmStructuredResult,
  LlmStructuredUsage,
  LlmUsage,
} from '../llm.types';

type OpenAiImageDetail = 'low' | 'high' | 'auto';

interface OpenAiRequestOptions {
  timeout?: number;
}

interface OpenAiResponsesApi {
  create(
    body: ResponseCreateParamsStreaming,
    options?: OpenAiRequestOptions,
  ): Promise<AsyncIterable<ResponseStreamEvent>>;
  create(
    body: ResponseCreateParamsNonStreaming,
    options?: OpenAiRequestOptions,
  ): Promise<OpenAiResponse>;
}

interface OpenAiClient {
  responses: OpenAiResponsesApi;
}

interface OpenAiOutputText {
  text: string;
  refusal: string;
}

const IMAGE_DETAIL_BY_RESOLUTION: Record<LlmMediaResolution, OpenAiImageDetail> = {
  low: 'low',
  medium: 'auto',
  high: 'high',
};

const OFF_EFFORT_LADDER: readonly (ReasoningEffort | null)[] = ['none', 'minimal', 'low', null];
const LEGACY_REASONING_MODEL = /^gpt-5(-|$)/;
const O_SERIES_MODEL = /^o\d/;
const NON_REASONING_MODEL = /^(gpt-4|gpt-3\.5|chatgpt-)/;
const REASONING_ERROR_MESSAGE = /reasoning|effort/i;
const BAD_REQUEST_STATUS = 400;

@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly name: LlmProviderName = 'openai';
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly offEffortStepByModel = new Map<string, number>();
  private client: OpenAiClient | null = null;

  constructor() {
    this.initClient();
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    return (await this.completeWithUsage(request)).text;
  }

  async completeWithUsage(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return this.createCompletion(request, []);
  }

  async completeMultimodal(request: LlmCompletionRequest): Promise<string> {
    return (await this.completeMultimodalWithUsage(request)).text;
  }

  async completeMultimodalWithUsage(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return this.createCompletion(request, request.images ?? []);
  }

  async completeStructured(request: LlmStructuredRequest): Promise<LlmStructuredResult> {
    const client = this.requireClient();
    const detail = request.options.mediaResolution
      ? IMAGE_DETAIL_BY_RESOLUTION[request.options.mediaResolution]
      : 'auto';
    const body: ResponseCreateParamsNonStreaming = {
      model: request.options.model,
      instructions: request.system,
      input: [
        {
          role: 'user',
          content: [
            ...this.toImageParts(request.images, detail),
            { type: 'input_text', text: request.prompt },
          ],
        },
      ],
      max_output_tokens: request.options.maxTokens,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: request.schemaName,
          schema: this.toStrictSchema(request.jsonSchema),
          strict: true,
        },
      },
    };

    const response = await this.createWithReasoning(client, body, request, {
      timeout: request.options.timeoutMs,
    });

    const output = this.extractOutput(response);
    const finishReason = this.toStructuredFinishReason(response, output);
    return {
      data: finishReason === 'refusal' ? null : this.parseStructuredText(output.text, request),
      rawText: output.text.length > 0 ? output.text : output.refusal,
      model: request.options.model,
      finishReason,
      usage: this.toStructuredUsage(response.usage),
      providerRequestId: response.id ?? null,
    };
  }

  async *streamWithTools(request: LlmAgentRequest): AsyncIterable<LlmAgentEvent> {
    const client = this.requireClient();
    const tools: FunctionTool[] = request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    }));

    const stream = await client.responses.create({
      model: request.options.model,
      instructions: request.system,
      input: this.toAgentInput(request.messages),
      max_output_tokens: request.options.maxTokens,
      store: false,
      stream: true,
      ...(tools.length > 0 ? { tools } : {}),
      ...this.samplingParams(request.options),
    });

    let sawFunctionCall = false;
    for await (const event of stream) {
      switch (event.type) {
        case 'response.output_text.delta':
          if (event.delta) yield { type: 'text_delta', text: event.delta };
          break;
        case 'response.output_item.done':
          if (event.item.type === 'function_call') {
            sawFunctionCall = true;
            yield {
              type: 'tool_call',
              id: event.item.call_id,
              name: event.item.name,
              input: this.parseToolArguments(event.item.arguments),
            };
          }
          break;
        case 'response.completed':
        case 'response.incomplete':
          if (event.response.usage) {
            yield {
              type: 'usage',
              inputTokens: event.response.usage.input_tokens,
              outputTokens: event.response.usage.output_tokens,
            };
          }
          yield { type: 'done', stopReason: this.toStopReason(event.response, sawFunctionCall) };
          break;
        case 'response.failed':
          throw new Error(event.response.error?.message ?? 'OpenAI no pudo completar la respuesta');
        case 'error':
          throw new Error(event.message);
        default:
          break;
      }
    }
  }

  private initClient(): void {
    const apiKey = process.env[LLM_PROVIDER_DEFAULTS.openai.apiKeyEnv];
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY no definida — provider openai deshabilitado');
      return;
    }
    try {
      this.client = new OpenAI({ apiKey }) as unknown as OpenAiClient;
    } catch (error) {
      reportServerError(error, { scope: 'OpenAiProvider.initClient' });
    }
  }

  private requireClient(): OpenAiClient {
    if (!this.client) {
      throw new Error('OpenAI provider no está disponible');
    }
    return this.client;
  }

  private async createCompletion(
    request: LlmCompletionRequest,
    images: LlmImagePart[],
  ): Promise<LlmCompletionResult> {
    const client = this.requireClient();
    const response = await client.responses.create({
      model: request.options.model,
      instructions: request.system,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: request.prompt },
            ...this.toImageParts(images, 'auto'),
          ],
        },
      ],
      max_output_tokens: request.options.maxTokens,
      store: false,
      ...this.samplingParams(request.options),
    });

    return {
      text: this.extractOutput(response).text,
      model: request.options.model,
      usage: this.toUsage(response.usage),
    };
  }

  private async createWithReasoning(
    client: OpenAiClient,
    body: ResponseCreateParamsNonStreaming,
    request: LlmStructuredRequest,
    options: OpenAiRequestOptions,
  ): Promise<OpenAiResponse> {
    const { model, reasoning } = request.options;
    if (reasoning !== 'off') {
      return client.responses.create({ ...body, reasoning: { effort: reasoning } }, options);
    }

    let step = this.offEffortStepByModel.get(model) ?? this.initialOffEffortStep(model);
    for (;;) {
      const effort = OFF_EFFORT_LADDER[step] ?? null;
      try {
        const response = await client.responses.create(
          effort === null ? body : { ...body, reasoning: { effort } },
          options,
        );
        this.offEffortStepByModel.set(model, step);
        return response;
      } catch (error) {
        if (effort === null || !this.isReasoningRejection(error)) throw error;
        this.logger.warn(
          `El modelo ${model} rechazó reasoning.effort=${effort}; se reintenta con el siguiente nivel`,
        );
        step += 1;
      }
    }
  }

  private initialOffEffortStep(model: string): number {
    if (NON_REASONING_MODEL.test(model)) return OFF_EFFORT_LADDER.indexOf(null);
    if (O_SERIES_MODEL.test(model)) return OFF_EFFORT_LADDER.indexOf('low');
    if (LEGACY_REASONING_MODEL.test(model)) return OFF_EFFORT_LADDER.indexOf('minimal');
    return 0;
  }

  private isReasoningRejection(error: unknown): boolean {
    return (
      error instanceof Error &&
      'status' in error &&
      (error as { status: unknown }).status === BAD_REQUEST_STATUS &&
      REASONING_ERROR_MESSAGE.test(error.message)
    );
  }

  private toImageParts(images: LlmImagePart[], detail: OpenAiImageDetail): ResponseInputContent[] {
    return images.map((image) => ({
      type: 'input_image',
      detail,
      image_url: `data:${image.mimeType};base64,${image.data}`,
    }));
  }

  private samplingParams(options: LlmCompletionOptions): { temperature?: number } {
    return options.temperature !== undefined ? { temperature: options.temperature } : {};
  }

  private extractOutput(response: OpenAiResponse): OpenAiOutputText {
    let text = '';
    let refusal = '';
    for (const item of response.output ?? []) {
      if (item.type !== 'message') continue;
      for (const part of item.content) {
        if (part.type === 'output_text') text += part.text;
        else if (part.type === 'refusal') refusal += part.refusal;
      }
    }
    return { text, refusal };
  }

  private toUsage(usage: ResponseUsage | undefined): LlmUsage | null {
    if (!usage) return null;
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    };
  }

  private toStructuredUsage(usage: ResponseUsage | undefined): LlmStructuredUsage | null {
    if (!usage) return null;
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
      cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      imageTokens: null,
    };
  }

  private toStructuredFinishReason(
    response: OpenAiResponse,
    output: OpenAiOutputText,
  ): LlmStructuredFinishReason {
    if (output.refusal.length > 0 && output.text.length === 0) return 'refusal';
    if (response.status === 'completed') return 'stop';
    if (response.status === 'incomplete') {
      const reason = response.incomplete_details?.reason;
      if (reason === 'max_output_tokens') return 'max_tokens';
      if (reason === 'content_filter') return 'safety';
    }
    return 'other';
  }

  private toStopReason(response: OpenAiResponse, sawFunctionCall: boolean): LlmAgentStopReason {
    if (sawFunctionCall) return 'tool_use';
    if (response.status === 'completed') return 'end_turn';
    if (response.incomplete_details?.reason === 'max_output_tokens') return 'max_tokens';
    return 'other';
  }

  private parseStructuredText(rawText: string, request: LlmStructuredRequest): unknown {
    try {
      return this.withoutInjectedNulls(request.jsonSchema, JSON.parse(rawText));
    } catch {
      return null;
    }
  }

  private parseToolArguments(json: string): unknown {
    const trimmed = json.trim();
    if (trimmed.length === 0) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      this.logger.warn(`No se pudo parsear el input de tool: ${trimmed}`);
      return {};
    }
  }

  private toAgentInput(messages: LlmAgentRequest['messages']): ResponseInputItem[] {
    const input: ResponseInputItem[] = [];
    for (const message of messages) {
      for (const block of message.content) {
        input.push(this.toAgentInputItem(message.role, block));
      }
    }
    return input;
  }

  private toAgentInputItem(
    role: LlmAgentRequest['messages'][number]['role'],
    block: LlmAgentContent,
  ): ResponseInputItem {
    switch (block.type) {
      case 'text':
        return { role, content: block.text };
      case 'tool_use':
        return {
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        };
      case 'tool_result':
        return {
          type: 'function_call_output',
          call_id: block.toolCallId,
          output: block.content,
        };
    }
  }

  private toStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const strict: Record<string, unknown> = { ...schema };
    delete strict.$schema;

    const properties = this.asRecord(strict.properties);
    if (properties) {
      const required = new Set(this.asStringArray(strict.required));
      const strictProperties: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(properties)) {
        const strictChild = this.toStrictChild(child);
        strictProperties[key] = required.has(key)
          ? strictChild
          : { anyOf: [strictChild, { type: 'null' }] };
      }
      strict.properties = strictProperties;
      strict.required = Object.keys(properties);
      strict.additionalProperties = false;
    }

    if (strict.items !== undefined) strict.items = this.toStrictChild(strict.items);
    if (Array.isArray(strict.oneOf)) {
      strict.anyOf = strict.oneOf;
      delete strict.oneOf;
    }
    for (const key of ['anyOf', 'allOf']) {
      const variants = strict[key];
      if (Array.isArray(variants)) {
        strict[key] = variants.map((variant: unknown) => this.toStrictChild(variant));
      }
    }
    for (const key of ['$defs', 'definitions']) {
      const definitions = this.asRecord(strict[key]);
      if (!definitions) continue;
      const strictDefinitions: Record<string, unknown> = {};
      for (const [name, definition] of Object.entries(definitions)) {
        strictDefinitions[name] = this.toStrictChild(definition);
      }
      strict[key] = strictDefinitions;
    }
    return strict;
  }

  private toStrictChild(child: unknown): unknown {
    const schema = this.asRecord(child);
    return schema ? this.toStrictSchema(schema) : child;
  }

  private withoutInjectedNulls(schema: unknown, value: unknown): unknown {
    const node = this.asRecord(schema);
    if (!node) return value;
    if (Array.isArray(value)) {
      return value.map((entry: unknown) => this.withoutInjectedNulls(node.items, entry));
    }
    const properties = this.asRecord(node.properties);
    const record = this.asRecord(value);
    if (!properties || !record) return value;

    const required = new Set(this.asStringArray(node.required));
    const cleaned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (child === null && !required.has(key)) continue;
      cleaned[key] = this.withoutInjectedNulls(properties[key], child);
    }
    return cleaned;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private asStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }
}
