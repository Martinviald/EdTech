import type {
  ReaderSpec,
  ReadingUsage,
  RenderedPrompt,
  TranscriptionOutput,
  TranscriptionStatus,
} from '@soe/types';
import type { ZodTypeAny } from 'zod';

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
}

export interface TranscriptionResult {
  readonly status: TranscriptionStatus;
  readonly output: TranscriptionOutput | null;
  readonly rawText: string | null;
  readonly providerModel: string;
  readonly usage: ReadingUsage | null;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  readonly errorCode: string | null;
}

export interface VisionTranscriber {
  readonly id: string;
  supports(reader: ReaderSpec): boolean;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}
