import type { ReaderSpec, TranscriptionOutput, TranscriptionStatus } from '@soe/types';
import type { TranscriptionRequest, TranscriptionResult, VisionTranscriber } from '../transcriber';

/** Falla programada: el transcriptor devuelve ese estado sin salida. */
export interface FakeFailure {
  readonly status: Exclude<TranscriptionStatus, 'ok'>;
  readonly errorCode?: string;
}

export type FakeReading = TranscriptionOutput | FakeFailure;

export interface FakeTranscriberOptions {
  /** Default: `'fake'`. Atiende a los lectores con ese `transcriberId`. */
  readonly id?: string;
  /** Salidas por `sha256` de la imagen. */
  readonly bySha256?: Readonly<Record<string, FakeReading>>;
  /** Salidas por `readingKey`; ganan a `bySha256`. */
  readonly byReadingKey?: Readonly<Record<string, FakeReading>>;
  /** Salidas por clave del lector y luego por `sha256`: distintas lecturas por lector. */
  readonly byReader?: Readonly<Record<string, Readonly<Record<string, FakeReading>>>>;
  /** Sin salida programada: este valor, o una falla `error` con `fake_missing`. */
  readonly fallback?: FakeReading;
}

export const FAKE_TRANSCRIBER_ID = 'fake';

function isFailure(reading: FakeReading): reading is FakeFailure {
  return !('literal' in reading);
}

/**
 * Transcriptor determinístico para tests: no llama a ningún proveedor, valida la
 * salida con el esquema del request y registra cada request en `calls`.
 */
export class FakeTranscriber implements VisionTranscriber {
  readonly id: string;
  readonly calls: TranscriptionRequest[] = [];

  constructor(private readonly options: FakeTranscriberOptions = {}) {
    this.id = options.id ?? FAKE_TRANSCRIBER_ID;
  }

  supports(reader: ReaderSpec): boolean {
    return reader.transcriberId === this.id;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    this.calls.push(request);
    const reading = this.programmedReading(request);
    const base = {
      providerModel: request.reader.model,
      usage: null,
      costUsd: 0,
      latencyMs: 0,
    };
    if (reading === undefined) {
      return { ...base, status: 'error', output: null, rawText: null, errorCode: 'fake_missing' };
    }
    if (isFailure(reading)) {
      return {
        ...base,
        status: reading.status,
        output: null,
        rawText: null,
        errorCode: reading.errorCode ?? `fake_${reading.status}`,
      };
    }
    const rawText = JSON.stringify(reading);
    const parsed = request.outputSchema.safeParse(reading);
    if (!parsed.success) {
      return { ...base, status: 'invalid_output', output: null, rawText, errorCode: 'schema' };
    }
    return { ...base, status: 'ok', output: reading, rawText, errorCode: null };
  }

  private programmedReading(request: TranscriptionRequest): FakeReading | undefined {
    const { byReadingKey, byReader, bySha256, fallback } = this.options;
    return (
      byReadingKey?.[request.readingKey] ??
      byReader?.[request.reader.key]?.[request.image.sha256] ??
      bySha256?.[request.image.sha256] ??
      fallback
    );
  }
}

/** Salida de lector mínima para tests: respondida, confianza 1 y sin alternativas. */
export function fakeOutput(
  literal: string,
  overrides: Partial<TranscriptionOutput> = {},
): TranscriptionOutput {
  return {
    characters: [...literal].map((char) => ({ shape: char, reading: char, alternatives: [] })),
    state: 'answered',
    literal,
    parts: null,
    alternativeReadings: [],
    confidence: 1,
    reviewRequested: false,
    notes: '',
    ...overrides,
  };
}
