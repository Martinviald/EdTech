import { HttpException, Injectable } from '@nestjs/common';
import type { TranscriptionResult } from '@soe/answer-reading';
import {
  LLM_PROVIDERS,
  type LlmProviderId,
  type ReaderSpec,
  type ReadingUsage,
  type TranscriptionOutput,
} from '@soe/types';
import { estimateLlmCostUsd } from '../../llm/llm.pricing';
import { LlmService } from '../../llm/llm.service';
import type { LlmStructuredResult } from '../../llm/llm.types';
import { ANSWER_READING_LLM_FEATURE } from '../answer-reading.constants';
import {
  TRANSCRIPTION_ERROR_CODES,
  type VisionTranscriber,
  type VisionTranscriptionRequest,
} from './vision-transcriber';

export const LLM_VISION_TRANSCRIBER_ID = 'llm';

const STRUCTURED_SCHEMA_NAME = 'answer_transcription';

const TIMEOUT_PATTERN = /time(d)?\s?out/i;

type FailureStatus = Pick<TranscriptionResult, 'status' | 'errorCode'>;

@Injectable()
export class LlmVisionTranscriber implements VisionTranscriber {
  readonly id = LLM_VISION_TRANSCRIBER_ID;

  constructor(private readonly llm: LlmService) {}

  supports(reader: ReaderSpec): boolean {
    return reader.transcriberId === this.id && this.llmProviderOf(reader) !== null;
  }

  async transcribe(request: VisionTranscriptionRequest): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    const provider = this.llmProviderOf(request.reader);
    if (provider === null) {
      return this.failed(request, startedAt, {
        status: 'error',
        errorCode: TRANSCRIPTION_ERROR_CODES.unsupportedProvider,
      });
    }
    const output = request.outputJsonSchema;
    const { params } = request.reader;
    try {
      const result = await this.llm.completeStructured(
        {
          system: request.prompt.system,
          prompt: request.prompt.user,
          images: [{ mimeType: request.image.mimeType, data: request.image.base64 }],
          jsonSchema: output.schema as unknown as Record<string, unknown>,
          schemaName: STRUCTURED_SCHEMA_NAME,
          propertyOrder: [...output.propertyOrder],
          reasoning: params.reasoning,
          mediaResolution: params.mediaResolution,
          maxTokens: params.maxOutputTokens,
          timeoutMs: params.timeoutMs,
          target: { provider, model: request.reader.model },
        },
        null,
        ANSWER_READING_LLM_FEATURE,
      );
      return this.toResult(request, result, Date.now() - startedAt);
    } catch (error) {
      return this.failed(request, startedAt, this.failureOf(error));
    }
  }

  private toResult(
    request: VisionTranscriptionRequest,
    result: LlmStructuredResult,
    latencyMs: number,
  ): TranscriptionResult {
    const usage = this.usageOf(result);
    const base = {
      providerModel: result.providerModel,
      usage,
      costUsd: this.costOf(result.model, usage),
      latencyMs,
      rawText: result.rawText,
    };
    if (result.finishReason === 'refusal' || result.finishReason === 'safety') {
      return { ...base, status: 'refused', output: null, errorCode: result.finishReason };
    }
    if (result.finishReason === 'max_tokens') {
      return { ...base, status: 'truncated', output: null, errorCode: result.finishReason };
    }
    if (result.data === null || result.data === undefined) {
      return {
        ...base,
        status: 'invalid_output',
        output: null,
        errorCode: TRANSCRIPTION_ERROR_CODES.invalidJson,
      };
    }
    const parsed = request.outputSchema.safeParse(result.data);
    if (!parsed.success) {
      return {
        ...base,
        status: 'invalid_output',
        output: null,
        errorCode: TRANSCRIPTION_ERROR_CODES.schemaMismatch,
      };
    }
    return { ...base, status: 'ok', output: parsed.data as TranscriptionOutput, errorCode: null };
  }

  private failed(
    request: VisionTranscriptionRequest,
    startedAt: number,
    failure: FailureStatus,
  ): TranscriptionResult {
    return {
      ...failure,
      output: null,
      rawText: null,
      providerModel: request.reader.model,
      usage: null,
      costUsd: null,
      latencyMs: Date.now() - startedAt,
    };
  }

  private failureOf(error: unknown): FailureStatus {
    if (error instanceof HttpException) {
      return { status: 'error', errorCode: TRANSCRIPTION_ERROR_CODES.providerNotConfigured };
    }
    if (this.isTimeout(error)) {
      return { status: 'timeout', errorCode: TRANSCRIPTION_ERROR_CODES.timeout };
    }
    const httpStatus = this.httpStatusOf(error);
    if (httpStatus === 429) {
      return { status: 'error', errorCode: TRANSCRIPTION_ERROR_CODES.rateLimited };
    }
    if (httpStatus !== null && httpStatus >= 500) {
      return { status: 'error', errorCode: TRANSCRIPTION_ERROR_CODES.providerUnavailable };
    }
    return { status: 'error', errorCode: TRANSCRIPTION_ERROR_CODES.providerError };
  }

  private isTimeout(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
      error.name === 'AbortError' ||
      TIMEOUT_PATTERN.test(error.name) ||
      TIMEOUT_PATTERN.test(error.message)
    );
  }

  private httpStatusOf(error: unknown): number | null {
    if (typeof error !== 'object' || error === null || !('status' in error)) return null;
    const status = (error as { status: unknown }).status;
    return typeof status === 'number' ? status : null;
  }

  private usageOf(result: LlmStructuredResult): ReadingUsage | null {
    if (result.usage === null) return null;
    return {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      imageTokens: result.usage.imageTokens,
    };
  }

  private costOf(model: string, usage: ReadingUsage | null): number | null {
    if (usage === null) return null;
    const cost = estimateLlmCostUsd(model, usage);
    return cost === null ? null : Number(cost);
  }

  private llmProviderOf(reader: ReaderSpec): LlmProviderId | null {
    const provider = LLM_PROVIDERS.find((candidate) => candidate === reader.provider);
    return provider ?? null;
  }
}
