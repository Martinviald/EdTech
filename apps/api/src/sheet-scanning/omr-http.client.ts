import {
  omrAssessResultSchema,
  scanResultSchema,
  type OmrAssessRequest,
  type OmrAssessResult,
  type OmrReadRequest,
  type ScanResult,
} from '@soe/types';
import type { ZodType } from 'zod';
import {
  OmrPageTimeoutError,
  OmrServiceUnavailableError,
  type OmrClient,
} from './omr-client.types';

export class OmrInvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmrInvalidResponseError';
  }
}

export class OmrRequestRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmrRequestRejectedError';
  }
}

export interface OmrFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type OmrFetchFn = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<OmrFetchResponse>;

export interface HttpOmrClientOptions {
  serviceUrl?: string;
  timeoutMs?: number;
  fetchFn?: OmrFetchFn;
  serviceToken?: string | null;
}

const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8090';
const DEFAULT_TIMEOUT_S = 120;

type PostOutcome<T> = { kind: 'success'; result: T } | { kind: 'unavailable'; detail: string };

export class HttpOmrClient implements OmrClient {
  private readonly serviceUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: OmrFetchFn;
  private readonly serviceToken: string | null;

  constructor(options: HttpOmrClientOptions = {}) {
    this.serviceUrl = options.serviceUrl ?? process.env.OMR_SERVICE_URL ?? DEFAULT_SERVICE_URL;
    this.timeoutMs = options.timeoutMs ?? resolveTimeoutMsFromEnv();
    this.fetchFn = options.fetchFn ?? (fetch as unknown as OmrFetchFn);
    this.serviceToken = options.serviceToken ?? process.env.OMR_SERVICE_TOKEN ?? null;
  }

  read(request: OmrReadRequest): Promise<ScanResult> {
    return this.postWithRetry('/v1/read', request, scanResultSchema, 'ScanResult');
  }

  assess(request: OmrAssessRequest): Promise<OmrAssessResult> {
    return this.postWithRetry('/v1/assess', request, omrAssessResultSchema, 'OmrAssessResult');
  }

  private async postWithRetry<T>(
    path: string,
    request: unknown,
    schema: ZodType<T>,
    resultName: string,
  ): Promise<T> {
    const first = await this.postOnce(path, request, schema, resultName);
    if (first.kind === 'success') return first.result;

    const second = await this.postOnce(path, request, schema, resultName);
    if (second.kind === 'success') return second.result;

    throw new OmrServiceUnavailableError(
      `El servicio de lectura no está disponible (${second.detail})`,
    );
  }

  private async postOnce<T>(
    path: string,
    request: unknown,
    schema: ZodType<T>,
    resultName: string,
  ): Promise<PostOutcome<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: OmrFetchResponse;
      try {
        response = await this.fetchFn(`${this.serviceUrl}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.serviceToken === null ? {} : { 'x-omr-token': this.serviceToken }),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new OmrPageTimeoutError(
            `La lectura excedió el tiempo límite total de ${this.timeoutMs / 1000}s`,
          );
        }
        return { kind: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
      }

      if (response.status === 504) {
        throw new OmrPageTimeoutError(
          'El servicio de lectura excedió el tiempo límite por página (HTTP 504)',
        );
      }
      if (response.status === 502) {
        return { kind: 'unavailable', detail: 'HTTP 502' };
      }
      if (response.status === 422) {
        const detail = await response.text().catch(() => '');
        throw new OmrRequestRejectedError(
          `El servicio de lectura rechazó el request como inválido (HTTP 422): ${detail}`,
        );
      }
      if (!response.ok) {
        return { kind: 'unavailable', detail: `HTTP ${response.status}` };
      }

      return {
        kind: 'success',
        result: await this.parseBody(response, controller.signal, schema, resultName),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseBody<T>(
    response: OmrFetchResponse,
    signal: AbortSignal,
    schema: ZodType<T>,
    resultName: string,
  ): Promise<T> {
    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      if (signal.aborted) {
        throw new OmrPageTimeoutError(
          `La lectura excedió el tiempo límite total de ${this.timeoutMs / 1000}s`,
        );
      }
      throw new OmrInvalidResponseError(
        `El servicio de lectura respondió 200 con un cuerpo que no es JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new OmrInvalidResponseError(
        `El servicio de lectura respondió 200 con un ${resultName} inválido: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  }
}

function resolveTimeoutMsFromEnv(): number {
  const raw = Number(process.env.OMR_READ_TIMEOUT_S);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_S;
  return seconds * 1000;
}
