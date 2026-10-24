import { HttpException, Injectable } from '@nestjs/common';
import {
  type InterpretationRequest,
  type InterpretationResult,
  type ReadingAuditRequest,
  type ReadingAuditResult,
  type StructuredVisionResult,
  type TranscriptionImage,
  type TranscriptionResult,
  type VerificationRequest,
  type VerificationResult,
} from '@soe/answer-reading';
import {
  LLM_PROVIDERS,
  readingAuditOutputSchema,
  verificationOutputSchema,
  type LlmProviderId,
  type ReaderSpec,
  type ReadingUsage,
  type RenderedPrompt,
  type TranscriptionOutput,
} from '@soe/types';
import type { ZodType } from 'zod';
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

const VERIFICATION_SCHEMA_NAME = 'incorrect_verification';

const READING_AUDIT_SCHEMA_NAME = 'reading_audit';
const INTERPRETATION_SCHEMA_NAME = 'answer_interpretation';

const TIMEOUT_PATTERN = /time(d)?\s?out/i;

type FailureStatus = Pick<TranscriptionResult, 'status' | 'errorCode'>;

interface StructuredVisionCall<TOutput> {
  readonly reader: ReaderSpec;
  readonly image: TranscriptionImage;
  readonly prompt: RenderedPrompt;
  readonly jsonSchema: Record<string, unknown>;
  readonly propertyOrder: readonly string[];
  readonly schemaName: string;
  readonly outputSchema: ZodType<TOutput>;
}

@Injectable()
export class LlmVisionTranscriber implements VisionTranscriber {
  readonly id = LLM_VISION_TRANSCRIBER_ID;

  constructor(private readonly llm: LlmService) {}

  supports(reader: ReaderSpec): boolean {
    return reader.transcriberId === this.id && this.llmProviderOf(reader) !== null;
  }

  async transcribe(request: VisionTranscriptionRequest): Promise<TranscriptionResult> {
    const output = request.outputJsonSchema;
    return this.complete<TranscriptionOutput>({
      reader: request.reader,
      image: request.image,
      prompt: request.prompt,
      jsonSchema: output.schema as unknown as Record<string, unknown>,
      propertyOrder: output.propertyOrder,
      schemaName: STRUCTURED_SCHEMA_NAME,
      outputSchema: request.outputSchema as ZodType<TranscriptionOutput>,
    });
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    return this.complete({
      reader: request.reader,
      image: request.image,
      prompt: request.prompt,
      jsonSchema: request.outputSchema.schema as unknown as Record<string, unknown>,
      propertyOrder: request.outputSchema.propertyOrder,
      schemaName: VERIFICATION_SCHEMA_NAME,
      outputSchema: verificationOutputSchema,
    });
  }

  async audit(request: ReadingAuditRequest): Promise<ReadingAuditResult> {
    return this.complete({
      reader: request.reader,
      image: request.image,
      prompt: request.prompt,
      jsonSchema: request.outputSchema.schema as unknown as Record<string, unknown>,
      propertyOrder: request.outputSchema.propertyOrder,
      schemaName: READING_AUDIT_SCHEMA_NAME,
      outputSchema: readingAuditOutputSchema,
    });
  }

  async interpret(request: InterpretationRequest): Promise<InterpretationResult> {
    return this.complete({
      reader: request.reader,
      image: request.image,
      prompt: request.prompt,
      jsonSchema: request.outputSchema.schema,
      propertyOrder: request.outputSchema.propertyOrder,
      schemaName: INTERPRETATION_SCHEMA_NAME,
      outputSchema: request.outputZodSchema,
    });
  }

  private async complete<TOutput>(
    call: StructuredVisionCall<TOutput>,
  ): Promise<StructuredVisionResult<TOutput>> {
    const startedAt = Date.now();
    const provider = this.llmProviderOf(call.reader);
    if (provider === null) {
      return this.failed(call.reader, startedAt, {
        status: 'error',
        errorCode: TRANSCRIPTION_ERROR_CODES.unsupportedProvider,
      });
    }
    const { params } = call.reader;
    try {
      const result = await this.llm.completeStructured(
        {
          system: call.prompt.system,
          prompt: call.prompt.user,
          images: [{ mimeType: call.image.mimeType, data: call.image.base64 }],
          jsonSchema: call.jsonSchema,
          schemaName: call.schemaName,
          propertyOrder: [...call.propertyOrder],
          reasoning: params.reasoning,
          mediaResolution: params.mediaResolution,
          maxTokens: params.maxOutputTokens,
          timeoutMs: params.timeoutMs,
          target: { provider, model: call.reader.model },
        },
        null,
        ANSWER_READING_LLM_FEATURE,
      );
      return this.toResult(call, result, Date.now() - startedAt);
    } catch (error) {
      return this.failed(call.reader, startedAt, this.failureOf(error));
    }
  }

  private toResult<TOutput>(
    call: StructuredVisionCall<TOutput>,
    result: LlmStructuredResult,
    latencyMs: number,
  ): StructuredVisionResult<TOutput> {
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
    const parsed = call.outputSchema.safeParse(result.data);
    if (!parsed.success) {
      return {
        ...base,
        status: 'invalid_output',
        output: null,
        errorCode: TRANSCRIPTION_ERROR_CODES.schemaMismatch,
      };
    }
    return { ...base, status: 'ok', output: parsed.data, errorCode: null };
  }

  private failed<TOutput>(
    reader: ReaderSpec,
    startedAt: number,
    failure: FailureStatus,
  ): StructuredVisionResult<TOutput> {
    return {
      ...failure,
      output: null,
      rawText: null,
      providerModel: reader.model,
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
