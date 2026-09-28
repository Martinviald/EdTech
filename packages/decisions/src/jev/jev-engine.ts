/**
 * Adaptador de Jev (TypeSafe AI). Junto con `jev-mapping.ts` es el único lugar
 * que conoce `@typesafe-ai/sdk`.
 */

import { TypeSafeClient, type RequestOptions, type TypeSafeClientConfig } from '@typesafe-ai/sdk';

import {
  DecisionError,
  type DecisionEngine,
  type DecisionQuestions,
  type DecisionRequest,
  type DecisionResult,
} from '../contracts';
import { assertWithinLimits } from '../questions';
import { mapSdkError, parseSystemOneResponse, toSdkQuestions } from './jev-mapping';

/** Versión fijada: los umbrales se calibran contra ella, no contra `jev-latest`. */
export const JEV_DEFAULT_MODEL = 'jev-1.13.0';

/** Variable de entorno de la API key (la misma que lee el SDK). */
export const JEV_API_KEY_ENV = 'TYPESAFE_API_KEY';

/** `fetch` compatible con el global; inyectable para tests. */
export type JevFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface JevEngineConfig {
  /** Si falta, se usa `TYPESAFE_API_KEY`. */
  readonly apiKey?: string;
  readonly baseURL?: string;
  /** Default: `JEV_DEFAULT_MODEL`. */
  readonly defaultModel?: string;
  /** Timeout por intento, en ms (default del SDK: 10 000). */
  readonly timeoutMs?: number;
  /** Reintentos tras el primer intento (default del SDK: 2). `0` los desactiva. */
  readonly maxRetries?: number;
  readonly fetch?: JevFetch;
}

export class JevDecisionEngine implements DecisionEngine {
  readonly name = 'jev';
  private client: TypeSafeClient | undefined;

  constructor(private readonly config: JevEngineConfig = {}) {}

  /** `true` si hay API key (en la config o en `TYPESAFE_API_KEY`). */
  isAvailable(): boolean {
    return this.resolveApiKey() !== undefined;
  }

  async evaluate<Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
  ): Promise<DecisionResult<Q>> {
    assertWithinLimits(request.state, request.questions);
    assertValidTimeout(request.timeoutMs);
    const client = this.getClient();

    const options: RequestOptions = {};
    if (request.timeoutMs !== undefined) options.timeout = request.timeoutMs;
    if (request.signal !== undefined) options.signal = request.signal;

    const started = performance.now();
    let raw: unknown;
    try {
      raw = await client.systemOne(
        {
          state: request.state,
          questions: toSdkQuestions(request.questions),
          model: request.model ?? this.defaultModel,
        },
        options,
      );
    } catch (error) {
      throw mapSdkError(error);
    }
    const latencyMs = performance.now() - started;

    const { answers, model, usage } = parseSystemOneResponse(request.questions, raw);
    return { answers, model, usage, latencyMs, engine: this.name };
  }

  private get defaultModel(): string {
    return this.config.defaultModel ?? JEV_DEFAULT_MODEL;
  }

  private resolveApiKey(): string | undefined {
    return this.config.apiKey?.trim() || process.env[JEV_API_KEY_ENV]?.trim() || undefined;
  }

  /** Construye el cliente la primera vez; sin key lanza `unavailable` sin tocar el SDK. */
  private getClient(): TypeSafeClient {
    if (this.client !== undefined) return this.client;

    const apiKey = this.resolveApiKey();
    if (apiKey === undefined) {
      throw new DecisionError('unavailable', `Jev no está configurado: falta ${JEV_API_KEY_ENV}.`);
    }

    const clientConfig: TypeSafeClientConfig = { apiKey, defaultModel: this.defaultModel };
    if (this.config.baseURL !== undefined) clientConfig.baseURL = this.config.baseURL;
    if (this.config.timeoutMs !== undefined) clientConfig.timeout = this.config.timeoutMs;
    if (this.config.maxRetries !== undefined)
      clientConfig.retry = { maxRetries: this.config.maxRetries };
    if (this.config.fetch !== undefined) clientConfig.fetch = this.config.fetch;

    let client: TypeSafeClient;
    try {
      client = new TypeSafeClient(clientConfig);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DecisionError(
        'unavailable',
        `No se pudo configurar el cliente de Jev: ${detail}`,
        error,
      );
    }
    this.client = client;
    return client;
  }
}

function assertValidTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs === undefined) return;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new DecisionError(
      'invalid_request',
      `timeoutMs debe ser un número positivo de ms (llegó ${timeoutMs}).`,
    );
  }
}
