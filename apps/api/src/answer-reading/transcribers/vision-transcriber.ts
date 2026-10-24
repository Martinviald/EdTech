import type {
  InterpretationRequest,
  InterpretationResult,
  ReadingAuditRequest,
  ReadingAuditResult,
  TranscriptionRequest,
  TranscriptionResult,
  VerificationRequest,
  VerificationResult,
} from '@soe/answer-reading';
import type { ReaderSpec, ResponseFormat } from '@soe/types';

export interface VisionTranscriptionRequest extends TranscriptionRequest {
  readonly format: ResponseFormat;
}

export interface VisionTranscriber {
  readonly id: string;
  supports(reader: ReaderSpec): boolean;
  transcribe(request: VisionTranscriptionRequest): Promise<TranscriptionResult>;
  verify?(request: VerificationRequest): Promise<VerificationResult>;
  audit?(request: ReadingAuditRequest): Promise<ReadingAuditResult>;
  interpret?(request: InterpretationRequest): Promise<InterpretationResult>;
}

export const VISION_TRANSCRIBERS = 'VISION_TRANSCRIBERS';

export const TRANSCRIPTION_ERROR_CODES = {
  timeout: 'timeout',
  providerUnavailable: 'provider_unavailable',
  rateLimited: 'rate_limited',
  providerError: 'provider_error',
  providerNotConfigured: 'provider_not_configured',
  unsupportedProvider: 'unsupported_provider',
  transcriberNotFound: 'transcriber_not_found',
  invalidJson: 'invalid_json',
  schemaMismatch: 'schema_mismatch',
} as const;

export const TRANSIENT_TRANSCRIPTION_ERROR_CODES: ReadonlySet<string> = new Set([
  TRANSCRIPTION_ERROR_CODES.timeout,
  TRANSCRIPTION_ERROR_CODES.providerUnavailable,
  TRANSCRIPTION_ERROR_CODES.rateLimited,
]);
