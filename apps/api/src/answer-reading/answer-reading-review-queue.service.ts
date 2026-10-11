import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  answerReadingDecisions,
  answerReadingRuns,
  answerReadings,
  answerReviews,
  files,
  items,
  sheetLayouts,
  sheetPrintRuns,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  users,
  withOrgContext,
  type AnswerReadingDecision,
  type AnswerReadingRow,
  type AnswerReview,
} from '@soe/db';
import type {
  GradingContext,
  NormalizedAnswer,
  ReaderReadingSummary,
  ResponseFormat,
  ReviewDecisionDetail,
  ReviewQueueGroup,
  ReviewQueuePage,
  ReviewQueueQuery,
  ReviewQueueScope,
  ReviewQueueSummary,
  ReviewReason,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { FilesService } from '../files/files.service';
import { AnswerReadingDecisionsService } from './answer-reading-decisions.service';
import { visionResponsesByField } from './answer-reading-layout.helpers';
import {
  decisionResponseFormat,
  formatLabelOf,
  normalizeLiteral,
  pendingReviewOf,
  scoringOutcomeOf,
  type PendingReview,
} from './answer-reading-review.helpers';
import { toReadingScoringItem, type ReadingScoringItem } from './answer-reading-scoring.helpers';

interface ScopeEntry {
  readonly decision: AnswerReadingDecision;
  readonly item: ReadingScoringItem | undefined;
  readonly printedNumber: string;
  readonly cropFileId: string | null;
  readonly activeReview: AnswerReview | undefined;
  readonly pending: PendingReview | null;
}

interface PendingEntry extends ScopeEntry {
  readonly pending: PendingReview;
}

interface QueueGroupDraft {
  readonly groupKey: string;
  readonly entries: PendingEntry[];
}

interface ItemSummaryDraft {
  itemId: string;
  printedNumber: string;
  formatLabel: string;
  pendingReading: number;
  pendingGrading: number;
}

const AUTO_OUTCOMES: ReadonlySet<AnswerReadingDecision['outcome']> = new Set([
  'auto_accepted',
  'auto_blank',
]);
const PRIORITY_REASONS: readonly ReviewReason[] = ['alternative_flips_outcome', 'readers_disagree'];
const UNKNOWN_PRINTED_NUMBER = '?';

@Injectable()
export class AnswerReadingReviewQueueService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly decisions: AnswerReadingDecisionsService,
    private readonly filesService: FilesService,
  ) {}

  async summary(orgId: string, scope: ReviewQueueScope): Promise<ReviewQueueSummary> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const decisions = await this.scopeDecisions(tx, orgId, scope);
      const entries = await this.loadEntries(tx, orgId, decisions);
      const inProgress = await this.countInProgress(tx, orgId, scope);
      return this.toSummary(entries, inProgress);
    });
  }

  async queue(orgId: string, query: ReviewQueueQuery): Promise<ReviewQueuePage> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const decisions = await this.scopeDecisions(tx, orgId, query);
      const entries = await this.loadEntries(tx, orgId, decisions);
      const groups = this.sortGroups(this.groupEntries(this.queueEntries(entries, query)));
      const offset = (query.page - 1) * query.pageSize;
      const pageGroups = groups.slice(offset, offset + query.pageSize);
      const pageEntries = pageGroups.flatMap((group) => group.entries);
      const readings = await this.readingsByDecision(
        tx,
        orgId,
        pageEntries.map((entry) => entry.decision),
      );
      const urls = await this.cropUrls(tx, orgId, pageEntries);
      return {
        data: pageGroups.map((group) => this.toQueueGroup(group, readings, urls)),
        total: groups.length,
        page: query.page,
        limit: query.pageSize,
      };
    });
  }

  async detail(orgId: string, decisionId: string): Promise<ReviewDecisionDetail> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [decision] = await tx
        .select()
        .from(answerReadingDecisions)
        .where(
          and(eq(answerReadingDecisions.orgId, orgId), eq(answerReadingDecisions.id, decisionId)),
        )
        .limit(1);
      if (!decision) throw new NotFoundException('No encontramos esa respuesta en tu organización');
      const [entry] = await this.loadEntries(tx, orgId, [decision]);
      if (!entry) throw new NotFoundException('No encontramos esa respuesta en tu organización');
      const readers = (await this.readingsByDecision(tx, orgId, [decision])).get(decision.id) ?? [];
      const urls = await this.cropUrls(tx, orgId, [entry]);
      const format = decisionResponseFormat(readers[0]?.responseFormat, entry.item);
      const mode = entry.pending?.mode ?? entry.activeReview?.mode ?? decision.reviewMode ?? null;
      const canonical =
        entry.pending?.canonical ?? entry.activeReview?.resultingCanonical ?? decision.canonical;
      const value = entry.pending?.value ?? entry.activeReview?.resultingValue ?? decision.value;
      const displayValue = this.displayValueOf(canonical, entry.activeReview, readers);
      return {
        decisionId: decision.id,
        itemId: decision.itemId,
        printedNumber: entry.printedNumber,
        formatKind: format.kind,
        responseFormat: format,
        formatLabel: formatLabelOf(format),
        outcome: decision.outcome,
        mode,
        reasons: entry.pending?.reasons ?? decision.reasons,
        canonical,
        displayValue,
        cropUrl: this.cropUrlOf(entry, urls),
        readers: readers.map((reading) => this.toReaderSummary(reading)),
        grading:
          mode === 'grading'
            ? this.gradingContext(entry, value, format, readers, displayValue)
            : null,
        history: await this.historyOf(tx, orgId, decision.id),
      };
    });
  }

  private async scopeDecisions(
    tx: Database,
    orgId: string,
    scope: { readonly assessmentId?: string; readonly batchId?: string },
  ): Promise<AnswerReadingDecision[]> {
    if (scope.assessmentId !== undefined) {
      return tx
        .select()
        .from(answerReadingDecisions)
        .where(
          and(
            eq(answerReadingDecisions.orgId, orgId),
            eq(answerReadingDecisions.assessmentId, scope.assessmentId),
            isNull(answerReadingDecisions.supersededById),
          ),
        );
    }
    if (scope.batchId === undefined) return [];
    const marks = await this.batchMarks(tx, orgId, [scope.batchId]);
    if (marks.length === 0) return [];
    return tx
      .select()
      .from(answerReadingDecisions)
      .where(
        and(
          eq(answerReadingDecisions.orgId, orgId),
          inArray(
            answerReadingDecisions.markId,
            marks.map((mark) => mark.id),
          ),
          isNull(answerReadingDecisions.supersededById),
        ),
      );
  }

  private async batchMarks(
    tx: Database,
    orgId: string,
    batchIds: readonly string[],
  ): Promise<Array<{ id: string; scanId: string; fieldId: string }>> {
    if (batchIds.length === 0) return [];
    const scans = await tx
      .select({ id: sheetScans.id })
      .from(sheetScans)
      .where(
        and(
          eq(sheetScans.orgId, orgId),
          inArray(sheetScans.batchId, [...batchIds]),
          ne(sheetScans.state, 'superseded'),
        ),
      );
    if (scans.length === 0) return [];
    return tx
      .select({
        id: sheetScanMarks.id,
        scanId: sheetScanMarks.scanId,
        fieldId: sheetScanMarks.fieldId,
      })
      .from(sheetScanMarks)
      .where(
        and(
          eq(sheetScanMarks.orgId, orgId),
          inArray(
            sheetScanMarks.scanId,
            scans.map((scan) => scan.id),
          ),
        ),
      );
  }

  private async loadEntries(
    tx: Database,
    orgId: string,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<ScopeEntry[]> {
    if (decisions.length === 0) return [];
    const itemRows = await tx
      .select({
        id: items.id,
        type: items.type,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(inArray(items.id, [...new Set(decisions.map((decision) => decision.itemId))]));
    const markRows = await tx
      .select({
        id: sheetScanMarks.id,
        printedNumber: sheetScanMarks.printedNumber,
        cropFileId: sheetScanMarks.cropFileId,
      })
      .from(sheetScanMarks)
      .where(
        and(
          eq(sheetScanMarks.orgId, orgId),
          inArray(sheetScanMarks.id, [...new Set(decisions.map((decision) => decision.markId))]),
        ),
      );
    const reviews = await this.decisions.activeReviewsByDecision(
      tx,
      orgId,
      decisions.map((decision) => decision.id),
    );
    const itemById = new Map(itemRows.map((row) => [row.id, toReadingScoringItem(row)]));
    const markById = new Map(markRows.map((row) => [row.id, row]));
    return decisions.map((decision) => {
      const item = itemById.get(decision.itemId);
      const mark = markById.get(decision.markId);
      const activeReview = reviews.get(decision.id);
      return {
        decision,
        item,
        printedNumber: mark?.printedNumber ?? UNKNOWN_PRINTED_NUMBER,
        cropFileId: mark?.cropFileId ?? null,
        activeReview,
        pending: pendingReviewOf(decision, activeReview, item),
      };
    });
  }

  private async countInProgress(
    tx: Database,
    orgId: string,
    scope: ReviewQueueScope,
  ): Promise<number> {
    const batches = await this.batchesWithRunningReading(
      tx,
      orgId,
      await this.scopeBatches(tx, orgId, scope),
    );
    if (batches.length === 0) return 0;
    const printRuns = await tx
      .select({ id: sheetPrintRuns.id, layoutId: sheetPrintRuns.layoutId })
      .from(sheetPrintRuns)
      .where(
        and(
          eq(sheetPrintRuns.orgId, orgId),
          inArray(sheetPrintRuns.id, [...new Set(batches.map((batch) => batch.printRunId))]),
        ),
      );
    const layouts =
      printRuns.length === 0
        ? []
        : await tx
            .select({ id: sheetLayouts.id, spec: sheetLayouts.spec })
            .from(sheetLayouts)
            .where(inArray(sheetLayouts.id, [...new Set(printRuns.map((run) => run.layoutId))]));
    const visionFieldIds = new Set<string>();
    for (const layout of layouts) {
      for (const fieldId of visionResponsesByField(layout.spec.fields).keys()) {
        visionFieldIds.add(fieldId);
      }
    }
    if (visionFieldIds.size === 0) return 0;
    const cropMarkIds = (
      await this.batchMarks(
        tx,
        orgId,
        batches.map((batch) => batch.id),
      )
    )
      .filter((mark) => visionFieldIds.has(mark.fieldId))
      .map((mark) => mark.id);
    if (cropMarkIds.length === 0) return 0;
    const decided = await tx
      .select({ markId: answerReadingDecisions.markId })
      .from(answerReadingDecisions)
      .where(
        and(
          eq(answerReadingDecisions.orgId, orgId),
          inArray(answerReadingDecisions.markId, cropMarkIds),
          isNull(answerReadingDecisions.supersededById),
        ),
      );
    const decidedMarks = new Set(decided.map((row) => row.markId));
    return cropMarkIds.filter((markId) => !decidedMarks.has(markId)).length;
  }

  private async batchesWithRunningReading(
    tx: Database,
    orgId: string,
    batches: ReadonlyArray<{ id: string; printRunId: string }>,
  ): Promise<Array<{ id: string; printRunId: string }>> {
    if (batches.length === 0) return [];
    const running = await tx
      .select({ batchId: answerReadingRuns.batchId })
      .from(answerReadingRuns)
      .where(
        and(
          eq(answerReadingRuns.orgId, orgId),
          inArray(
            answerReadingRuns.batchId,
            batches.map((batch) => batch.id),
          ),
          eq(answerReadingRuns.status, 'running'),
        ),
      );
    const runningBatchIds = new Set(running.map((run) => run.batchId));
    return batches.filter((batch) => runningBatchIds.has(batch.id));
  }

  private async scopeBatches(
    tx: Database,
    orgId: string,
    scope: ReviewQueueScope,
  ): Promise<Array<{ id: string; printRunId: string }>> {
    const columns = { id: sheetScanBatches.id, printRunId: sheetScanBatches.printRunId };
    if (scope.batchId !== undefined) {
      return tx
        .select(columns)
        .from(sheetScanBatches)
        .where(and(eq(sheetScanBatches.orgId, orgId), eq(sheetScanBatches.id, scope.batchId)));
    }
    if (scope.assessmentId === undefined) return [];
    const runs = await tx
      .select({ id: sheetPrintRuns.id })
      .from(sheetPrintRuns)
      .where(
        and(eq(sheetPrintRuns.orgId, orgId), eq(sheetPrintRuns.assessmentId, scope.assessmentId)),
      );
    if (runs.length === 0) return [];
    return tx
      .select(columns)
      .from(sheetScanBatches)
      .where(
        and(
          eq(sheetScanBatches.orgId, orgId),
          inArray(
            sheetScanBatches.printRunId,
            runs.map((run) => run.id),
          ),
        ),
      );
  }

  private toSummary(entries: readonly ScopeEntry[], inProgress: number): ReviewQueueSummary {
    let pendingReading = 0;
    let pendingGrading = 0;
    let pendingAudit = 0;
    let autoAccepted = 0;
    let reviewed = 0;
    const byItem = new Map<string, ItemSummaryDraft>();
    for (const entry of entries) {
      if (entry.pending === null) {
        if (entry.activeReview) reviewed++;
        else if (AUTO_OUTCOMES.has(entry.decision.outcome)) autoAccepted++;
        continue;
      }
      const isReading = entry.pending.mode === 'reading';
      if (isReading) pendingReading++;
      else pendingGrading++;
      if (entry.pending.isAudit) pendingAudit++;
      let item = byItem.get(entry.decision.itemId);
      if (!item) {
        item = {
          itemId: entry.decision.itemId,
          printedNumber: entry.printedNumber,
          formatLabel: formatLabelOf(decisionResponseFormat(null, entry.item)),
          pendingReading: 0,
          pendingGrading: 0,
        };
        byItem.set(entry.decision.itemId, item);
      }
      if (isReading) item.pendingReading++;
      else item.pendingGrading++;
    }
    return {
      pendingReading,
      pendingGrading,
      pendingAudit,
      autoAccepted,
      inProgress,
      reviewed,
      total: reviewed + pendingReading + pendingGrading,
      byItem: [...byItem.values()].sort((left, right) =>
        this.comparePrintedNumbers(left.printedNumber, right.printedNumber),
      ),
    };
  }

  private queueEntries(entries: readonly ScopeEntry[], query: ReviewQueueQuery): PendingEntry[] {
    const selected: PendingEntry[] = [];
    for (const entry of entries) {
      const { pending } = entry;
      if (pending === null) continue;
      if (query.mode !== undefined && pending.mode !== query.mode) continue;
      if (query.itemId !== undefined && entry.decision.itemId !== query.itemId) continue;
      if (pending.isAudit && query.includeAudit !== true) continue;
      selected.push({ ...entry, pending });
    }
    return selected;
  }

  private groupEntries(entries: readonly PendingEntry[]): QueueGroupDraft[] {
    const groups = new Map<string, PendingEntry[]>();
    for (const entry of entries) {
      const key = this.groupKeyOf(entry);
      let members = groups.get(key);
      if (!members) {
        members = [];
        groups.set(key, members);
      }
      members.push(entry);
    }
    return [...groups].map(([groupKey, members]) => ({ groupKey, entries: members }));
  }

  private groupKeyOf(entry: PendingEntry): string {
    const { decision, pending } = entry;
    const value = pending.canonical ?? `decision:${decision.id}`;
    return `${decision.itemId}|${pending.mode}|${value}`;
  }

  private sortGroups(groups: QueueGroupDraft[]): QueueGroupDraft[] {
    const ranked = groups.map((group) => ({
      group,
      priority: this.priorityOf(group),
      printedNumber: group.entries[0]?.printedNumber ?? UNKNOWN_PRINTED_NUMBER,
    }));
    ranked.sort(
      (left, right) =>
        right.group.entries.length - left.group.entries.length ||
        left.priority - right.priority ||
        this.comparePrintedNumbers(left.printedNumber, right.printedNumber) ||
        left.group.groupKey.localeCompare(right.group.groupKey),
    );
    return ranked.map((entry) => entry.group);
  }

  private priorityOf(group: QueueGroupDraft): number {
    let best = PRIORITY_REASONS.length;
    for (const entry of group.entries) {
      for (const reason of entry.pending.reasons) {
        const index = PRIORITY_REASONS.indexOf(reason);
        if (index !== -1 && index < best) best = index;
      }
    }
    return best;
  }

  private comparePrintedNumbers(left: string, right: string): number {
    return left.localeCompare(right, 'es', { numeric: true });
  }

  private async readingsByDecision(
    tx: Database,
    orgId: string,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<Map<string, AnswerReadingRow[]>> {
    const readingIds = new Set<string>();
    const markIdsWithoutReadings = new Set<string>();
    for (const decision of decisions) {
      if (decision.usedReadingIds.length === 0) markIdsWithoutReadings.add(decision.markId);
      for (const readingId of decision.usedReadingIds) readingIds.add(readingId);
    }
    const byId =
      readingIds.size === 0
        ? []
        : await tx
            .select()
            .from(answerReadings)
            .where(
              and(eq(answerReadings.orgId, orgId), inArray(answerReadings.id, [...readingIds])),
            );
    const byMark =
      markIdsWithoutReadings.size === 0
        ? []
        : await tx
            .select()
            .from(answerReadings)
            .where(
              and(
                eq(answerReadings.orgId, orgId),
                inArray(answerReadings.markId, [...markIdsWithoutReadings]),
                ne(answerReadings.mode, 'shadow'),
              ),
            )
            .orderBy(asc(answerReadings.createdAt));
    const readingById = new Map(byId.map((row) => [row.id, row]));
    const readingsByMark = new Map<string, AnswerReadingRow[]>();
    for (const row of byMark) {
      let list = readingsByMark.get(row.markId);
      if (!list) {
        list = [];
        readingsByMark.set(row.markId, list);
      }
      list.push(row);
    }
    const result = new Map<string, AnswerReadingRow[]>();
    for (const decision of decisions) {
      if (decision.usedReadingIds.length === 0) {
        result.set(decision.id, readingsByMark.get(decision.markId) ?? []);
        continue;
      }
      const used: AnswerReadingRow[] = [];
      for (const readingId of decision.usedReadingIds) {
        const reading = readingById.get(readingId);
        if (reading) used.push(reading);
      }
      result.set(decision.id, used);
    }
    return result;
  }

  private async cropUrls(
    tx: Database,
    orgId: string,
    entries: readonly ScopeEntry[],
  ): Promise<Map<string, string | null>> {
    const fileIds = new Set<string>();
    for (const entry of entries) {
      if (entry.cropFileId !== null) fileIds.add(entry.cropFileId);
    }
    if (fileIds.size === 0) return new Map();
    const rows = await tx
      .select()
      .from(files)
      .where(and(eq(files.orgId, orgId), inArray(files.id, [...fileIds])));
    return new Map(
      rows.map((row) => [row.id, this.filesService.buildDownloadUrl(row, 'inline') ?? null]),
    );
  }

  private cropUrlOf(entry: ScopeEntry, urls: ReadonlyMap<string, string | null>): string | null {
    return entry.cropFileId === null ? null : (urls.get(entry.cropFileId) ?? null);
  }

  private toQueueGroup(
    group: QueueGroupDraft,
    readingsByDecision: ReadonlyMap<string, AnswerReadingRow[]>,
    urls: ReadonlyMap<string, string | null>,
  ): ReviewQueueGroup {
    const [first] = group.entries;
    if (!first) throw new Error('Grupo de revisión vacío');
    const readers = readingsByDecision.get(first.decision.id) ?? [];
    const format = decisionResponseFormat(readers[0]?.responseFormat, first.item);
    const { pending } = first;
    const displayValue = this.displayValueOf(pending.canonical, first.activeReview, readers);
    const reasons = new Set<ReviewReason>();
    for (const entry of group.entries) {
      for (const reason of entry.pending.reasons) reasons.add(reason);
    }
    return {
      groupKey: group.groupKey,
      itemId: first.decision.itemId,
      printedNumber: first.printedNumber,
      formatKind: format.kind,
      responseFormat: format,
      formatLabel: formatLabelOf(format),
      mode: pending.mode,
      canonical: pending.canonical,
      displayValue,
      reasons: [...reasons],
      size: group.entries.length,
      members: group.entries.map((entry) => ({
        decisionId: entry.decision.id,
        cropUrl: this.cropUrlOf(entry, urls),
        isAudit: entry.pending.isAudit,
      })),
      readers: readers.map((reading) => this.toReaderSummary(reading)),
      grading:
        pending.mode === 'grading'
          ? this.gradingContext(first, pending.value, format, readers, displayValue)
          : null,
    };
  }

  private displayValueOf(
    canonical: string | null,
    activeReview: AnswerReview | undefined,
    readers: readonly AnswerReadingRow[],
  ): string | null {
    if (activeReview?.editedLiteral) return activeReview.editedLiteral;
    if (canonical === null) return null;
    for (const reading of readers) {
      if (reading.literal !== null && reading.normalized?.canonical === canonical) {
        return reading.literal;
      }
    }
    return canonical;
  }

  private toReaderSummary(reading: AnswerReadingRow): ReaderReadingSummary {
    const output = reading.output;
    return {
      readingId: reading.id,
      readerKey: reading.readerKey,
      provider: reading.provider,
      model: reading.model,
      state: reading.readingState,
      literal: reading.literal,
      canonical: reading.normalized?.canonical ?? null,
      confidence: reading.confidence === null ? null : Number(reading.confidence),
      alternatives: (output?.alternativeReadings ?? []).map((alternative) => ({
        literal: alternative.literal,
        plausibility: alternative.plausibility,
      })),
      reviewRequested: output?.reviewRequested ?? false,
      notes: output?.notes ? output.notes : null,
      status: reading.status,
    };
  }

  private gradingContext(
    entry: ScopeEntry,
    value: NormalizedAnswer | null,
    format: ResponseFormat,
    readers: readonly AnswerReadingRow[],
    displayValue: string | null,
  ): GradingContext {
    const content = entry.item?.content as Record<string, unknown> | undefined;
    const accepted = content?.acceptedAnswers;
    const literals = new Set<string>();
    if (displayValue) literals.add(displayValue);
    for (const reading of readers) {
      if (reading.literal) literals.add(reading.literal);
      for (const alternative of reading.output?.alternativeReadings ?? []) {
        if (alternative.literal) literals.add(alternative.literal);
      }
    }
    return {
      acceptedAnswers: Array.isArray(accepted)
        ? accepted.filter((answer): answer is string => typeof answer === 'string')
        : [],
      unit: typeof content?.unit === 'string' ? content.unit : null,
      proposedOutcome:
        value !== null
          ? scoringOutcomeOf(entry.item, value)
          : (entry.decision.scoringOutcome ?? null),
      optionOutcomes: [...literals].map((literal) => ({
        literal,
        outcome: scoringOutcomeOf(entry.item, normalizeLiteral(literal, format)),
      })),
    };
  }

  private async historyOf(
    tx: Database,
    orgId: string,
    decisionId: string,
  ): Promise<ReviewDecisionDetail['history']> {
    const reviews = await tx
      .select()
      .from(answerReviews)
      .where(and(eq(answerReviews.orgId, orgId), eq(answerReviews.decisionId, decisionId)))
      .orderBy(asc(answerReviews.createdAt));
    if (reviews.length === 0) return [];
    const reviewers = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(reviews.map((review) => review.reviewerId))]));
    const nameById = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer.name]));
    return reviews.map((review) => ({
      reviewId: review.id,
      action: review.action,
      editedLiteral: review.editedLiteral,
      reviewerName: nameById.get(review.reviewerId) ?? null,
      createdAt: review.createdAt.toISOString(),
      superseded: review.supersededById !== null,
    }));
  }
}
