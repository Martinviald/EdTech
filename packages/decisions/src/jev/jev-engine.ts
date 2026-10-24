/**
 * Adaptador de Jev (TypeSafe AI). Junto con `jev-mapping.ts` es el único lugar
 * que conoce `@typesafe-ai/sdk`.
 */

import {
  Image,
  TypeSafeClient,
  type RequestOptions,
  type SystemOneRequest,
  type TypeSafeClientConfig,
} from '@typesafe-ai/sdk';

import {
  DecisionError,
  type DecisionEngine,
  type DecisionEngineCapabilities,
  type DecisionEngineLimits,
  type DecisionImage,
  type DecisionQuestions,
  type DecisionRequest,
  type DecisionResult,
  type DecisionState,
} from '../contracts';
import { fitImage } from '../images/fit-image';
import { assertImagesSupported, assertValidTimeout, assertWithinLimits } from '../questions';
import { JEV_IMAGE_TARGET_MIN_SIDE_PX, JEV_LIMITS } from './jev-limits';
import { mapSdkError, parseSystemOneResponse, toSdkQuestions } from './jev-mapping';

/** Header que habilita las imágenes (experimentales) en la API de Jev. */
export const JEV_IMAGES_HEADER = 'TypeSafe-Danger-Zone-Images';

/** Clave reservada del estado donde va la referencia a la imagen (o `imagenes` si son varias). */
export const JEV_IMAGE_STATE_KEY = 'imagen';
export const JEV_IMAGES_STATE_KEY = 'imagenes';

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
  /**
   * Habilita las imágenes, que en Jev son experimentales (`TypeSafe-Danger-Zone-Images`).
   * Default `false`: un request con imágenes falla con `invalid_request`. La API lo
   * enciende con `JEV_EXPERIMENTAL_IMAGES=true`.
   */
  readonly experimentalImages?: boolean;
  /** Compresión del cuerpo (default del SDK: zstd). `false` la apaga; útil en tests. */
  readonly compression?: false;
}

export class JevDecisionEngine implements DecisionEngine {
  readonly name = 'jev';
  /** Acepta imágenes solo con `experimentalImages`; si no, un request con `images` falla con `invalid_request`. */
  readonly capabilities: DecisionEngineCapabilities;
  readonly limits: DecisionEngineLimits = JEV_LIMITS;
  private client: TypeSafeClient | undefined;

  constructor(private readonly config: JevEngineConfig = {}) {
    this.capabilities = { images: config.experimentalImages === true };
  }

  /** `true` si hay API key (en la config o en `TYPESAFE_API_KEY`). */
  isAvailable(): boolean {
    return this.resolveApiKey() !== undefined;
  }

  async evaluate<Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
  ): Promise<DecisionResult<Q>> {
    assertImagesSupported(this, request.images);
    assertWithinLimits(request.state, request.questions, this.limits, request.images);
    assertValidTimeout(request.timeoutMs);
    const images = request.images ?? [];
    const state = images.length > 0 ? this.stateWithImages(request.state, images.length) : null;
    const client = this.getClient();

    const options: RequestOptions = {};
    if (request.timeoutMs !== undefined) options.timeout = request.timeoutMs;
    if (request.signal !== undefined) options.signal = request.signal;
    if (images.length > 0) options.headers = { [JEV_IMAGES_HEADER]: 'true' };

    const sdkState =
      state === null
        ? request.state
        : await this.attachImages(state, images, request.signal, request.timeoutMs);

    const started = performance.now();
    let raw: unknown;
    try {
      const sdkRequest: SystemOneRequest = {
        state: sdkState,
        questions: toSdkQuestions(request.questions),
        model: request.model ?? this.defaultModel,
      };
      raw = await client.systemOne(sdkRequest, options);
    } catch (error) {
      throw mapSdkError(error);
    }
    const latencyMs = performance.now() - started;

    const { answers, model, usage } = parseSystemOneResponse(request.questions, raw);
    return { answers, model, usage, latencyMs, engine: this.name };
  }

  /**
   * El estado donde se insertará la referencia de la imagen: un objeto recibe la
   * clave reservada `imagen` (o `imagenes`); un texto se envuelve en `{ texto }` y
   * un arreglo en `{ elementos }`. Si el objeto ya trae la clave → `invalid_request`.
   * Jev exige que la referencia aparezca en el estado (si no, responde 400).
   */
  private stateWithImages(state: DecisionState, count: number): Record<string, unknown> {
    const key = count === 1 ? JEV_IMAGE_STATE_KEY : JEV_IMAGES_STATE_KEY;
    if (typeof state === 'string') return { texto: state };
    if (Array.isArray(state)) return { elementos: state };
    if (Object.hasOwn(state, JEV_IMAGE_STATE_KEY) || Object.hasOwn(state, JEV_IMAGES_STATE_KEY)) {
      throw new DecisionError(
        'invalid_request',
        `El estado ya trae la clave reservada "${key}": Jev la usa para referenciar la imagen.`,
      );
    }
    return { ...state };
  }

  /** Descarga (si es URL), ajusta a `JEV_IMAGE_CONSTRAINTS` y agrega cada imagen al estado. */
  private async attachImages(
    state: Record<string, unknown>,
    images: readonly DecisionImage[],
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
  ): Promise<SystemOneRequest['state']> {
    const constraints = this.limits.imageConstraints;
    const sdkImages: Image[] = [];
    for (const image of images) {
      const bytes = await this.imageBytes(image, signal, timeoutMs);
      const fitted =
        constraints === null
          ? bytes
          : (await fitImage(bytes, constraints, JEV_IMAGE_TARGET_MIN_SIDE_PX)).data;
      sdkImages.push(new Image(fitted));
    }
    const withImages =
      sdkImages.length === 1
        ? { ...state, [JEV_IMAGE_STATE_KEY]: sdkImages[0] }
        : { ...state, [JEV_IMAGES_STATE_KEY]: sdkImages };
    return withImages as SystemOneRequest['state'];
  }

  /** Bytes de la imagen. Jev necesita los bytes: una `{ url }` se descarga; un 404 u otra falla → `upstream`. */
  /** Con `timeoutMs`, la descarga también tiene ese tope (además del `signal` del llamador). */
  private async imageBytes(
    image: DecisionImage,
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
  ): Promise<Uint8Array> {
    if (!('url' in image)) return Buffer.from(image.data, 'base64');
    const fetchImpl: JevFetch = this.config.fetch ?? ((input, init) => fetch(input, init));
    const signals = [
      signal,
      timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs),
    ].filter((s): s is AbortSignal => s !== undefined);
    const combined = signals.length === 0 ? undefined : AbortSignal.any(signals);
    let response: Response;
    try {
      response = await fetchImpl(image.url, combined === undefined ? {} : { signal: combined });
    } catch (error) {
      if (signal?.aborted)
        throw new DecisionError('aborted', 'La descarga de la imagen se canceló.', error);
      if (combined?.aborted)
        throw new DecisionError(
          'timeout',
          'La descarga de la imagen para Jev excedió el plazo.',
          error,
        );
      throw new DecisionError('upstream', 'No se pudo descargar la imagen para Jev.', error);
    }
    if (!response.ok) {
      throw new DecisionError(
        'upstream',
        `No se pudo descargar la imagen para Jev (HTTP ${response.status}).`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
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
    if (this.config.compression !== undefined) clientConfig.compression = this.config.compression;

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
