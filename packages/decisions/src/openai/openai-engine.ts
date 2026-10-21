/**
 * Adaptador de OpenAI Decisions (`POST /v1/decisions`, beta pública). Junto con
 * `openai-mapping.ts` es el único lugar del paquete que conoce el SDK `openai`.
 * A diferencia de Jev, acepta imágenes (`capabilities.images`).
 */

import OpenAI, { type ClientOptions } from 'openai';
import type { RequestOptions } from 'openai/internal/request-options';

import {
  DecisionError,
  type DecisionEngine,
  type DecisionEngineCapabilities,
  type DecisionEngineLimits,
  type DecisionQuestions,
  type DecisionRequest,
  type DecisionResult,
} from '../contracts';
import { assertImagesSupported, assertValidTimeout, assertWithinLimits } from '../questions';
import { OPENAI_LIMITS } from './openai-limits';
import {
  mapSdkError,
  parseDecisionResponse,
  toOpenAiInput,
  toOpenAiQuestions,
} from './openai-mapping';

/** Único modelo disponible en la beta. La API lo devuelve sin versión. */
export const OPENAI_DECISIONS_DEFAULT_MODEL = 'gpt-6-luna';

/** Variable de entorno de la API key (la misma que usa `OpenAiProvider` en la API). */
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';

/** `fetch` compatible con el global; inyectable para tests. */
export type OpenAiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenAiEngineConfig {
  /** Si falta, se usa `OPENAI_API_KEY`. */
  readonly apiKey?: string;
  readonly baseURL?: string;
  /** Default: `OPENAI_DECISIONS_DEFAULT_MODEL`. */
  readonly defaultModel?: string;
  /** Timeout por intento, en ms (default del SDK: 10 minutos). */
  readonly timeoutMs?: number;
  /** Reintentos tras el primer intento (default del SDK: 2). `0` los desactiva. */
  readonly maxRetries?: number;
  readonly fetch?: OpenAiFetch;
}

export class OpenAiDecisionEngine implements DecisionEngine {
  readonly name = 'openai';
  readonly capabilities: DecisionEngineCapabilities = { images: true };
  readonly limits: DecisionEngineLimits = OPENAI_LIMITS;
  private client: OpenAI | undefined;

  constructor(private readonly config: OpenAiEngineConfig = {}) {}

  /** `true` si hay API key (en la config o en `OPENAI_API_KEY`). */
  isAvailable(): boolean {
    return this.resolveApiKey() !== undefined;
  }

  async evaluate<Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
  ): Promise<DecisionResult<Q>> {
    assertImagesSupported(this, request.images);
    assertWithinLimits(request.state, request.questions, this.limits, request.images);
    assertValidTimeout(request.timeoutMs);
    const client = this.getClient();

    const options: RequestOptions = {};
    if (request.timeoutMs !== undefined) options.timeout = request.timeoutMs;
    if (request.signal !== undefined) options.signal = request.signal;

    const started = performance.now();
    let raw: unknown;
    try {
      raw = await client.decisions.create(
        {
          model: request.model ?? this.defaultModel,
          input: toOpenAiInput(request.state, request.images),
          questions: toOpenAiQuestions(request.questions),
        },
        options,
      );
    } catch (error) {
      throw mapSdkError(error);
    }
    const latencyMs = performance.now() - started;

    const { answers, model, usage } = parseDecisionResponse(request.questions, raw);
    return { answers, model, usage, latencyMs, engine: this.name };
  }

  private get defaultModel(): string {
    return this.config.defaultModel ?? OPENAI_DECISIONS_DEFAULT_MODEL;
  }

  private resolveApiKey(): string | undefined {
    return this.config.apiKey?.trim() || process.env[OPENAI_API_KEY_ENV]?.trim() || undefined;
  }

  /** Construye el cliente la primera vez; sin key lanza `unavailable` sin tocar el SDK. */
  private getClient(): OpenAI {
    if (this.client !== undefined) return this.client;

    const apiKey = this.resolveApiKey();
    if (apiKey === undefined) {
      throw new DecisionError(
        'unavailable',
        `OpenAI Decisions no está configurado: falta ${OPENAI_API_KEY_ENV}.`,
      );
    }

    const clientOptions: ClientOptions = { apiKey };
    if (this.config.baseURL !== undefined) clientOptions.baseURL = this.config.baseURL;
    if (this.config.timeoutMs !== undefined) clientOptions.timeout = this.config.timeoutMs;
    if (this.config.maxRetries !== undefined) clientOptions.maxRetries = this.config.maxRetries;
    if (this.config.fetch !== undefined) clientOptions.fetch = this.config.fetch;

    let client: OpenAI;
    try {
      client = new OpenAI(clientOptions);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DecisionError(
        'unavailable',
        `No se pudo configurar el cliente de OpenAI: ${detail}`,
        error,
      );
    }
    this.client = client;
    return client;
  }
}
