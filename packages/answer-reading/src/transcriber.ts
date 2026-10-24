import type {
  ReaderSpec,
  ReadingAuditOutput,
  ReadingUsage,
  RenderedPrompt,
  TranscriptionOutput,
  TranscriptionStatus,
  VerificationOutput,
} from '@soe/types';
import type { ZodTypeAny } from 'zod';
import type { ReadingAuditJsonSchema } from './audit/reading-audit-json-schema';
import type { TranscriptionJsonSchema } from './formats/transcription-json-schema';
import type { VerificationJsonSchema } from './verification/verification-json-schema';
import type {
  InterpretationJsonSchema,
  InterpretationOutput,
  interpretationOutputSchema,
} from './interpretation/interpretation-output';

// Puerto de transcripción (diseño §4 S4). Las implementaciones reales viven en la
// API sobre el módulo LLM; aquí solo el contrato y un transcriptor falso.

export interface TranscriptionImage {
  readonly mimeType: 'image/jpeg' | 'image/png';
  readonly base64: string;
  readonly sha256: string;
}

export interface TranscriptionRequest {
  readonly readingKey: string;
  readonly image: TranscriptionImage;
  readonly reader: ReaderSpec;
  readonly prompt: RenderedPrompt;
  readonly outputSchema: ZodTypeAny;
  /** JSON Schema plano que se pide al proveedor; trae las mismas `parts` que `outputSchema`. */
  readonly outputJsonSchema: TranscriptionJsonSchema;
}

export interface StructuredVisionResult<TOutput> {
  readonly status: TranscriptionStatus;
  readonly output: TOutput | null;
  readonly rawText: string | null;
  readonly providerModel: string;
  readonly usage: ReadingUsage | null;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly errorCode: string | null;
}

export type TranscriptionResult = StructuredVisionResult<TranscriptionOutput>;

/** Pedido al verificador de incorrectas (T4): el prompt ya lleva la clave y la lectura acordada. */
export interface VerificationRequest {
  readonly readingKey: string;
  readonly image: TranscriptionImage;
  readonly reader: ReaderSpec;
  readonly prompt: RenderedPrompt;
  readonly outputSchema: VerificationJsonSchema;
}

export type VerificationResult = StructuredVisionResult<VerificationOutput>;

/** Pedido al auditor de lectura: el prompt ya lleva la transcripción candidata (nunca la clave). */
export interface ReadingAuditRequest {
  readonly readingKey: string;
  readonly image: TranscriptionImage;
  readonly reader: ReaderSpec;
  readonly prompt: RenderedPrompt;
  readonly outputSchema: ReadingAuditJsonSchema;
}

export type ReadingAuditResult = StructuredVisionResult<ReadingAuditOutput>;

/** Pedido al lector que interpreta (`transcribe.interpret@n`): nunca lleva la clave. */
export interface InterpretationRequest {
  readonly readingKey: string;
  readonly image: TranscriptionImage;
  readonly reader: ReaderSpec;
  readonly prompt: RenderedPrompt;
  readonly outputSchema: InterpretationJsonSchema;
  readonly outputZodSchema: typeof interpretationOutputSchema;
}

export type InterpretationResult = StructuredVisionResult<InterpretationOutput>;

/**
 * `verify` y `audit` son opcionales: un transcriptor que no verifica deja la casilla en
 * revisión, y uno que no audita no acepta nada que no haya aceptado el consenso.
 */
export interface VisionTranscriber {
  readonly id: string;
  supports(reader: ReaderSpec): boolean;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  verify?(request: VerificationRequest): Promise<VerificationResult>;
  audit?(request: ReadingAuditRequest): Promise<ReadingAuditResult>;
  interpret?(request: InterpretationRequest): Promise<InterpretationResult>;
}
