import {
  readingAuditOutputSchema,
  verificationOutputSchema,
  type ReaderSpec,
  type ReadingAuditOutput,
  type TranscriptionOutput,
  type TranscriptionStatus,
  type VerificationOutput,
} from '@soe/types';
import type {
  ReadingAuditRequest,
  ReadingAuditResult,
  TranscriptionRequest,
  TranscriptionResult,
  VerificationRequest,
  VerificationResult,
  VisionTranscriber,
} from '../transcriber';

/** Falla programada: el transcriptor devuelve ese estado sin salida. */
export interface FakeFailure {
  readonly status: Exclude<TranscriptionStatus, 'ok'>;
  readonly errorCode?: string;
}

export type FakeReading = TranscriptionOutput | FakeFailure;

export type FakeVerdict = VerificationOutput | FakeFailure;

export type FakeAudit = ReadingAuditOutput | FakeFailure;

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
  /** Veredictos del verificador de incorrectas por clave del lector y luego por `sha256`. */
  readonly verdicts?: Readonly<Record<string, Readonly<Record<string, FakeVerdict>>>>;
  /** Veredictos del auditor de lectura por clave del lector y luego por `sha256`. */
  readonly audits?: Readonly<Record<string, Readonly<Record<string, FakeAudit>>>>;
}

export const FAKE_TRANSCRIBER_ID = 'fake';

function isFailure(reading: FakeReading): reading is FakeFailure {
  return !('literal' in reading);
}

function isFailedVerdict(verdict: FakeVerdict): verdict is FakeFailure {
  return !('couldBeKey' in verdict);
}

function isFailedAudit(audit: FakeAudit): audit is FakeFailure {
  return !('verdict' in audit);
}

/**
 * Transcriptor determinístico para tests: no llama a ningún proveedor, valida la
 * salida con el esquema del request y registra cada request en `calls`.
 */
export class FakeTranscriber implements VisionTranscriber {
  readonly id: string;
  readonly calls: TranscriptionRequest[] = [];
  readonly verifyCalls: VerificationRequest[] = [];
  readonly auditCalls: ReadingAuditRequest[] = [];

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

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    this.verifyCalls.push(request);
    const verdict = this.options.verdicts?.[request.reader.key]?.[request.image.sha256];
    const base = { providerModel: request.reader.model, usage: null, costUsd: 0, latencyMs: 0 };
    if (verdict === undefined) {
      return { ...base, status: 'error', output: null, rawText: null, errorCode: 'fake_missing' };
    }
    if (isFailedVerdict(verdict)) {
      return {
        ...base,
        status: verdict.status,
        output: null,
        rawText: null,
        errorCode: verdict.errorCode ?? `fake_${verdict.status}`,
      };
    }
    const parsed = verificationOutputSchema.safeParse(verdict);
    const rawText = JSON.stringify(verdict);
    if (!parsed.success) {
      return { ...base, status: 'invalid_output', output: null, rawText, errorCode: 'schema' };
    }
    return { ...base, status: 'ok', output: parsed.data, rawText, errorCode: null };
  }

  async audit(request: ReadingAuditRequest): Promise<ReadingAuditResult> {
    this.auditCalls.push(request);
    const audit = this.options.audits?.[request.reader.key]?.[request.image.sha256];
    const base = { providerModel: request.reader.model, usage: null, costUsd: 0, latencyMs: 0 };
    if (audit === undefined) {
      return { ...base, status: 'error', output: null, rawText: null, errorCode: 'fake_missing' };
    }
    if (isFailedAudit(audit)) {
      return {
        ...base,
        status: audit.status,
        output: null,
        rawText: null,
        errorCode: audit.errorCode ?? `fake_${audit.status}`,
      };
    }
    const parsed = readingAuditOutputSchema.safeParse(audit);
    const rawText = JSON.stringify(audit);
    if (!parsed.success) {
      return { ...base, status: 'invalid_output', output: null, rawText, errorCode: 'schema' };
    }
    return { ...base, status: 'ok', output: parsed.data, rawText, errorCode: null };
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

/** Veredicto del verificador para tests. */
export function fakeVerdict(couldBeKey: boolean, confidence = 1): VerificationOutput {
  return { notes: '', differingCharacters: [], couldBeKey, confidence };
}

/** Veredicto del auditor de lectura para tests. */
export function fakeAudit(
  verdict: ReadingAuditOutput['verdict'],
  confidence = 1,
): ReadingAuditOutput {
  return { notes: '', suspiciousCharacters: [], verdict, confidence };
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
