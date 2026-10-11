import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  evaluateConsensus,
  isAuditSample,
  isTranscriptionPromptFor,
  needsTiebreak,
  normalizeTranscription,
  renderTranscriptionPrompt,
  transcriptionZodSchema,
  type ConsensusReading,
  type ScoreOf,
  type TranscriptionImage,
  type TranscriptionResult,
} from '@soe/answer-reading';
import { answerReadings, withOrgContext } from '@soe/db';
import {
  DEFAULT_CONSENSUS_POLICY,
  reviewModeFor,
  type ConsensusPolicy,
  type ConsensusResult,
  type CropEvidence,
  type ReaderSpec,
  type ReadingMode,
  type RenderedPrompt,
  type ResponseFormat,
  type ReviewReason,
  type TranscriptionOutput,
  type TranscriptionStatus,
} from '@soe/types';
import type { ZodTypeAny } from 'zod';
import { reportServerError } from '../common/observability/report-error';
import { InjectDb, type Database } from '../database/database.types';
import { FilesService } from '../files/files.service';
import { readingScoringOutcome, type ReadingScoringItem } from './answer-reading-scoring.helpers';
import { ANSWER_READING_OPTIONS, type AnswerReadingOptions } from './answer-reading.constants';
import type { RouteForCrop } from './reading-routes.service';
import {
  TRANSCRIPTION_ERROR_CODES,
  TRANSIENT_TRANSCRIPTION_ERROR_CODES,
} from './transcribers/vision-transcriber';
import { VisionTranscriberRegistry } from './transcribers/vision-transcriber.registry';

export type NotReadReason = Extract<
  ReviewReason,
  | 'external_vision_disabled'
  | 'insufficient_readers'
  | 'reading_disabled'
  | 'budget_exceeded'
  | 'run_limit_exceeded'
  | 'crop_unavailable'
  | 'reader_failed'
>;

export interface CropReadingTask {
  readonly orgId: string;
  readonly runId: string;
  readonly markId: string;
  readonly item: ReadingScoringItem;
  readonly format: ResponseFormat;
  readonly cropProfileId: string;
  readonly cropFileId: string | null;
  readonly cropEvidence: CropEvidence | null;
  readonly gradeName: string | null;
  readonly route: RouteForCrop | null;
  readonly blockedReason: NotReadReason | null;
}

export interface CropReadingOutcome {
  readonly result: ConsensusResult;
  readonly routeId: string | null;
  readonly routeVersion: number | null;
  readonly costUsd: number;
}

interface ReaderPlan {
  readonly reader: ReaderSpec;
  readonly mode: ReadingMode;
  readonly prompt: RenderedPrompt;
  readonly outputSchema: ZodTypeAny;
  readonly readingKey: string;
  readonly lookupKey: string;
}

interface StoredReading {
  readonly id: string;
  readonly readingKey: string;
  readonly readerKey: string;
  readonly mode: ReadingMode;
  readonly attempt: number;
  readonly status: TranscriptionStatus;
  readonly family: string;
  readonly output: TranscriptionOutput | null;
}

interface ExistingReadings {
  readonly reusable: Map<string, StoredReading>;
  readonly lastAttempt: Map<string, number>;
}

interface ExecutedReading {
  readonly mode: ReadingMode;
  readonly reading: ConsensusReading;
  readonly costUsd: number;
}

interface PersistedAttempt {
  readonly id: string;
  readonly status: TranscriptionStatus;
  readonly output: TranscriptionOutput | null;
  readonly errorCode: string | null;
  readonly costUsd: number;
}

interface ReadingScope {
  readonly task: CropReadingTask;
  readonly route: RouteForCrop;
  readonly cropSha256: string;
  readonly image: () => Promise<TranscriptionImage>;
}

@Injectable()
export class CropReadingService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly filesService: FilesService,
    private readonly transcribers: VisionTranscriberRegistry,
    @Inject(ANSWER_READING_OPTIONS) private readonly options: AnswerReadingOptions,
  ) {}

  async read(task: CropReadingTask): Promise<CropReadingOutcome> {
    const policy = task.route?.route.policy ?? DEFAULT_CONSENSUS_POLICY;
    const scoreOf = this.scoreOf(task.item);
    const notReadReason = this.notReadReasonOf(task);
    if (notReadReason !== null || this.isBlankByInk(policy, task) || task.route === null) {
      return this.withoutReaders(task, policy, scoreOf, notReadReason ?? 'insufficient_readers');
    }
    const image = this.lazyImage(task.orgId, task.cropFileId as string);
    let cropSha256: string;
    try {
      cropSha256 = task.cropEvidence?.sha256 ?? (await image()).sha256;
    } catch (error) {
      this.reportCropUnavailable(task, error);
      return this.withoutReaders(task, policy, scoreOf, 'crop_unavailable');
    }
    const scope: ReadingScope = { task, route: task.route, cropSha256, image };
    const plans = this.plansFor(scope);
    const existing = await this.loadExisting(
      task.orgId,
      plans.map((plan) => plan.readingKey),
    );
    if (plans.some((plan) => !existing.reusable.has(plan.lookupKey))) {
      try {
        await image();
      } catch (error) {
        this.reportCropUnavailable(task, error);
        return this.withoutReaders(task, policy, scoreOf, 'crop_unavailable');
      }
    }
    const executed = await Promise.all(
      plans.map((plan) => this.readWithReader(scope, plan, existing)),
    );
    let costUsd = executed.reduce((sum, entry) => sum + entry.costUsd, 0);
    const readings = executed
      .filter((entry) => entry.mode === 'primary')
      .map((entry) => entry.reading);
    const consensusOptions = {
      format: task.format,
      inkRatio: task.cropEvidence?.inkRatio ?? null,
      readingKey: this.consensusKey(task, cropSha256),
    };
    let result = evaluateConsensus(readings, policy, scoreOf, consensusOptions);
    const tiebreakReader = policy.tiebreakReader;
    if (
      tiebreakReader !== null &&
      this.readsFormat(tiebreakReader, task) &&
      needsTiebreak(result, readings, policy)
    ) {
      const plan = this.planFor(scope, tiebreakReader, 'tiebreak');
      const tiebreak = await this.readWithReader(
        scope,
        plan,
        await this.loadExisting(task.orgId, [plan.readingKey]),
      );
      costUsd += tiebreak.costUsd;
      result = evaluateConsensus(
        [...readings, tiebreak.reading],
        policy,
        scoreOf,
        consensusOptions,
      );
    }
    return {
      result,
      routeId: task.route.route.routeId,
      routeVersion: task.route.route.routeVersion,
      costUsd,
    };
  }

  private withoutReaders(
    task: CropReadingTask,
    policy: ConsensusPolicy,
    scoreOf: ScoreOf,
    reason: NotReadReason,
  ): CropReadingOutcome {
    const evaluated = evaluateConsensus([], policy, scoreOf, {
      format: task.format,
      inkRatio: task.cropEvidence?.inkRatio ?? null,
      readingKey: this.consensusKey(task, task.cropEvidence?.sha256 ?? null),
    });
    const result: ConsensusResult =
      evaluated.outcome === 'not_read'
        ? { ...evaluated, reasons: [reason], reviewMode: reviewModeFor([reason]) }
        : evaluated;
    return {
      result,
      routeId: task.route?.route.routeId ?? null,
      routeVersion: task.route?.route.routeVersion ?? null,
      costUsd: 0,
    };
  }

  private notReadReasonOf(task: CropReadingTask): NotReadReason | null {
    if (task.blockedReason !== null) return task.blockedReason;
    if (task.route === null) return 'insufficient_readers';
    if (task.route.notReadReason !== null) return task.route.notReadReason;
    if (task.route.route.readers.length === 0) return 'insufficient_readers';
    if (!task.route.route.readers.every((reader) => this.readsFormat(reader, task))) {
      return 'insufficient_readers';
    }
    if (task.cropFileId === null) return 'crop_unavailable';
    return null;
  }

  private readsFormat(reader: ReaderSpec, task: CropReadingTask): boolean {
    return isTranscriptionPromptFor(reader.promptRef, task.format.kind);
  }

  private isBlankByInk(policy: ConsensusPolicy, task: CropReadingTask): boolean {
    const inkRatio = task.cropEvidence?.inkRatio;
    return (
      policy.blankByInkBelow !== null &&
      inkRatio !== undefined &&
      inkRatio !== null &&
      inkRatio < policy.blankByInkBelow
    );
  }

  private plansFor(scope: ReadingScope): ReaderPlan[] {
    const { route } = scope.route;
    const shadows = route.shadowReaders.filter(
      (reader) =>
        this.readsFormat(reader, scope.task) &&
        isAuditSample(`${scope.cropSha256}:${reader.key}:shadow`, scope.route.shadowSampleRate),
    );
    return [
      ...route.readers.map((reader) => this.planFor(scope, reader, 'primary')),
      ...shadows.map((reader) => this.planFor(scope, reader, 'shadow')),
    ];
  }

  private planFor(scope: ReadingScope, reader: ReaderSpec, mode: ReadingMode): ReaderPlan {
    const { task } = scope;
    const { prompt } = renderTranscriptionPrompt(reader, task.format, {
      gradeName: task.gradeName,
    });
    const readingKey = this.sha256(
      [scope.cropSha256, task.item.id, prompt.ref, prompt.outputSchemaId, task.cropProfileId].join(
        '|',
      ),
    );
    return {
      reader,
      mode,
      prompt,
      outputSchema: transcriptionZodSchema(task.format),
      readingKey,
      lookupKey: this.lookupKey(readingKey, reader.key, mode),
    };
  }

  private async loadExisting(
    orgId: string,
    readingKeys: readonly string[],
  ): Promise<ExistingReadings> {
    const reusable = new Map<string, StoredReading>();
    const lastAttempt = new Map<string, number>();
    if (readingKeys.length === 0) return { reusable, lastAttempt };
    const rows: StoredReading[] = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({
          id: answerReadings.id,
          readingKey: answerReadings.readingKey,
          readerKey: answerReadings.readerKey,
          mode: answerReadings.mode,
          attempt: answerReadings.attempt,
          status: answerReadings.status,
          family: answerReadings.family,
          output: answerReadings.output,
        })
        .from(answerReadings)
        .where(
          and(
            eq(answerReadings.orgId, orgId),
            inArray(answerReadings.readingKey, [...new Set(readingKeys)]),
          ),
        ),
    );
    for (const row of rows) {
      const key = this.lookupKey(row.readingKey, row.readerKey, row.mode);
      lastAttempt.set(key, Math.max(lastAttempt.get(key) ?? 0, row.attempt));
      const current = reusable.get(key);
      if (
        row.status === 'ok' &&
        row.output !== null &&
        (!current || row.attempt > current.attempt)
      ) {
        reusable.set(key, row);
      }
    }
    return { reusable, lastAttempt };
  }

  private async readWithReader(
    scope: ReadingScope,
    plan: ReaderPlan,
    existing: ExistingReadings,
  ): Promise<ExecutedReading> {
    const role = plan.mode === 'tiebreak' ? 'tiebreak' : 'primary';
    const reused = existing.reusable.get(plan.lookupKey);
    if (reused) {
      return {
        mode: plan.mode,
        costUsd: 0,
        reading: {
          readingId: reused.id,
          family: reused.family,
          status: reused.status,
          output: reused.output,
          role,
        },
      };
    }
    const firstAttempt = (existing.lastAttempt.get(plan.lookupKey) ?? 0) + 1;
    let attempt = await this.transcribeAndPersist(scope, plan, firstAttempt);
    let costUsd = attempt.costUsd;
    if (this.isTransient(attempt)) {
      await this.pause(this.options.retryDelayMs);
      attempt = await this.transcribeAndPersist(scope, plan, firstAttempt + 1);
      costUsd += attempt.costUsd;
    }
    return {
      mode: plan.mode,
      costUsd,
      reading: {
        readingId: attempt.id,
        family: plan.reader.family,
        status: attempt.status,
        output: attempt.output,
        role,
      },
    };
  }

  private async transcribeAndPersist(
    scope: ReadingScope,
    plan: ReaderPlan,
    attempt: number,
  ): Promise<PersistedAttempt> {
    const { task } = scope;
    const image = await scope.image();
    const result = await this.transcribe(scope, plan, image);
    if (result.status === 'error' || result.status === 'timeout') {
      reportServerError(new Error(`La lectura por visión terminó en ${result.status}`), {
        orgId: task.orgId,
        runId: task.runId,
        readerKey: plan.reader.key,
        errorCode: result.errorCode,
      });
    }
    const output = result.status === 'ok' ? result.output : null;
    const usage = result.usage;
    const costUsd = result.costUsd ?? 0;
    const id = randomUUID();
    await withOrgContext(this.db, task.orgId, (tx) =>
      tx.insert(answerReadings).values({
        id,
        orgId: task.orgId,
        runId: task.runId,
        markId: task.markId,
        itemId: task.item.id,
        cropFileId: task.cropFileId,
        cropSha256: scope.cropSha256,
        cropProfileId: task.cropProfileId,
        responseFormat: task.format,
        readingKey: plan.readingKey,
        mode: plan.mode,
        attempt,
        routeId: scope.route.route.routeId,
        routeVersion: scope.route.route.routeVersion,
        readerKey: plan.reader.key,
        transcriberId: plan.reader.transcriberId,
        provider: plan.reader.provider,
        family: plan.reader.family,
        model: plan.reader.model,
        providerModel: result.providerModel,
        promptRef: plan.prompt.ref,
        promptHash: plan.prompt.hash,
        outputSchemaId: plan.prompt.outputSchemaId,
        params: plan.reader.params,
        status: result.status,
        output,
        readingState: output?.state ?? null,
        literal: output?.literal ?? null,
        confidence: output === null ? null : output.confidence.toFixed(3),
        rawText: result.status === 'invalid_output' ? result.rawText : null,
        normalized: output === null ? null : normalizeTranscription(output, task.format),
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        reasoningTokens: usage?.reasoningTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
        imageTokens: usage?.imageTokens ?? null,
        costUsd: costUsd.toFixed(6),
        latencyMs: result.latencyMs,
        errorCode: result.errorCode,
      }),
    );
    return { id, status: result.status, output, errorCode: result.errorCode, costUsd };
  }

  private async transcribe(
    scope: ReadingScope,
    plan: ReaderPlan,
    image: TranscriptionImage,
  ): Promise<TranscriptionResult> {
    const transcriber = this.transcribers.forReader(plan.reader);
    if (transcriber === null) {
      return this.failedTranscription(plan.reader, TRANSCRIPTION_ERROR_CODES.transcriberNotFound);
    }
    try {
      return await transcriber.transcribe({
        readingKey: plan.readingKey,
        image,
        reader: plan.reader,
        prompt: plan.prompt,
        outputSchema: plan.outputSchema,
        format: scope.task.format,
      });
    } catch (error) {
      reportServerError(error, {
        orgId: scope.task.orgId,
        runId: scope.task.runId,
        readerKey: plan.reader.key,
      });
      return this.failedTranscription(plan.reader, TRANSCRIPTION_ERROR_CODES.providerError);
    }
  }

  private failedTranscription(reader: ReaderSpec, errorCode: string): TranscriptionResult {
    return {
      status: 'error',
      output: null,
      rawText: null,
      providerModel: reader.model,
      usage: null,
      costUsd: null,
      latencyMs: 0,
      errorCode,
    };
  }

  private isTransient(attempt: PersistedAttempt): boolean {
    if (attempt.status === 'timeout') return true;
    return (
      attempt.status === 'error' &&
      attempt.errorCode !== null &&
      TRANSIENT_TRANSCRIPTION_ERROR_CODES.has(attempt.errorCode)
    );
  }

  private scoreOf(item: ReadingScoringItem): ScoreOf {
    return (answer) => readingScoringOutcome(item, answer);
  }

  private lazyImage(orgId: string, cropFileId: string): () => Promise<TranscriptionImage> {
    let pending: Promise<TranscriptionImage> | null = null;
    return () => {
      pending ??= this.downloadCrop(orgId, cropFileId);
      return pending;
    };
  }

  private async downloadCrop(orgId: string, cropFileId: string): Promise<TranscriptionImage> {
    const record = await this.filesService.getById(orgId, cropFileId);
    const url = this.filesService.buildDownloadUrl(record, 'inline');
    if (!url) {
      throw new Error('El storage de archivos no está configurado: no se puede leer el recorte');
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el recorte (HTTP ${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      mimeType: record.mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
      base64: buffer.toString('base64'),
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  private reportCropUnavailable(task: CropReadingTask, error: unknown): void {
    reportServerError(error, { orgId: task.orgId, runId: task.runId, markId: task.markId });
  }

  private consensusKey(task: CropReadingTask, cropSha256: string | null): string {
    return this.sha256([cropSha256 ?? task.markId, task.item.id, task.cropProfileId].join('|'));
  }

  private lookupKey(readingKey: string, readerKey: string, mode: ReadingMode): string {
    return `${readingKey}|${readerKey}|${mode}`;
  }

  private sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  private pause(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
