import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  answerReadingDecisions,
  answerReadings,
  items,
  printedSheets,
  responses,
  sheetPrintRuns,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  withOrgContext,
  type AnswerReadingDecision,
  type AnswerReview,
} from '@soe/db';
import { isSupportedFormatKind, toScoringInput } from '@soe/answer-reading';
import type { NormalizedAnswer } from '@soe/types';
import type { PrescoredAnswer, ResponseAiScore } from '../answer-sheets/lib/parsers/parser.types';
import { AssessmentResultsService } from '../assessment-results/assessment-results.service';
import { InjectDb, type Database } from '../database/database.types';
import { AnswerReadingDecisionsService } from './answer-reading-decisions.service';
import {
  scoreReadingValue,
  toReadingScoringItem,
  type ReadingScoringItem,
} from './answer-reading-scoring.helpers';

export interface ReadingConfirmation {
  readonly decisionId: string;
  readonly itemId: string;
  readonly prescored: PrescoredAnswer | null;
}

export interface ConfirmedReadingLink {
  readonly decisionId: string;
  readonly studentId: string;
  readonly itemId: string;
  readonly consolidated: boolean;
}

export interface ConfirmedReadingsInput {
  readonly assessmentId: string;
  readonly links: readonly ConfirmedReadingLink[];
  readonly cropMarkIds: readonly string[];
}

export type HumanResolution =
  | { readonly kind: 'reading'; readonly value: NormalizedAnswer; readonly reason?: string }
  | {
      readonly kind: 'grading';
      readonly isCorrect: boolean;
      readonly score?: number;
      readonly reason?: string;
    }
  | {
      readonly kind: 'rubric';
      readonly levelCode: string;
      readonly isCorrect: boolean;
      readonly score: number;
      readonly reason?: string;
    }
  | { readonly kind: UnansweredKind };

export type UnansweredKind = 'illegible' | 'blank' | 'crossed_out';

export interface HumanResolutionEntry {
  readonly decisionId: string;
  readonly resolution: HumanResolution;
}

export const CONSOLIDATION_SKIP_REASONS = [
  'not_current',
  'no_response',
  'human_scored',
  'undecidable',
] as const;
export type ConsolidationSkipReason = (typeof CONSOLIDATION_SKIP_REASONS)[number];

export interface ConsolidationSkip {
  readonly decisionId: string;
  readonly reason: ConsolidationSkipReason;
}

export interface ConsolidationReport {
  readonly scored: string[];
  readonly pending: string[];
  readonly skipped: ConsolidationSkip[];
  readonly recalculatedAssessmentIds: string[];
}

type ResponseHumanScore = NonNullable<(typeof responses.$inferInsert)['humanScore']>;

interface ReadingSummary {
  readonly confidence: number | null;
  readonly model: string;
  readonly promptRef: string;
}

interface ScoringContext {
  readonly items: ReadonlyMap<string, ReadingScoringItem>;
  readonly readings: ReadonlyMap<string, ReadingSummary>;
}

interface TargetResponse {
  readonly id: string;
  readonly assessmentId: string;
  readonly hasHumanScore: boolean;
  readonly isPending: boolean;
  readonly writtenByDecisionId: string | null;
}

interface ScoredValue {
  readonly answer: unknown;
  readonly isCorrect: boolean;
  readonly rawScore: number;
}

interface ResponseWrite {
  readonly decisionId: string;
  readonly responseId: string;
  readonly assessmentId: string;
  readonly value: Record<string, unknown>;
  readonly isCorrect: boolean | null;
  readonly rawScore: number | null;
  readonly scoredBy: 'auto' | 'ai' | 'human';
  readonly aiScore: ResponseAiScore | null;
  readonly humanScore: ResponseHumanScore | null;
  readonly respectHuman: boolean;
  readonly clearHuman?: boolean;
}

interface DecisionLink {
  readonly decisionId: string;
  readonly responseId: string;
  readonly resolved: boolean;
}

interface WriteOutcome {
  readonly scored: string[];
  readonly pending: string[];
  readonly skipped: ConsolidationSkip[];
  readonly assessmentIds: string[];
}

const PENDING_READING_VALUE = { answer: null, pendingReading: true } as const;
const UNANSWERED_RESOLUTIONS: Record<UnansweredKind, { flag: string; overrideReason: string }> = {
  illegible: { flag: 'illegible', overrideReason: 'ilegible' },
  blank: { flag: 'blank', overrideReason: 'en blanco' },
  crossed_out: { flag: 'crossedOut', overrideReason: 'tachada' },
};

@Injectable()
export class AnswerReadingConsolidationService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly decisions: AnswerReadingDecisionsService,
    private readonly results: AssessmentResultsService,
  ) {}

  async readingsForConfirmation(
    orgId: string,
    batchId: string,
  ): Promise<Map<string, ReadingConfirmation>> {
    const current = await this.decisions.findCurrentByBatch(orgId, batchId);
    if (current.size === 0) return new Map();
    const decisions = [...current.values()];
    const context = await withOrgContext(this.db, orgId, (tx) =>
      this.loadScoringContext(tx, decisions),
    );
    const confirmations = new Map<string, ReadingConfirmation>();
    for (const decision of decisions) {
      confirmations.set(decision.markId, {
        decisionId: decision.id,
        itemId: decision.itemId,
        prescored: this.prescore(decision, context),
      });
    }
    return confirmations;
  }

  async linkConfirmedResponses(
    orgId: string,
    input: ConfirmedReadingsInput,
  ): Promise<ConsolidationReport | null> {
    if (input.cropMarkIds.length === 0) return null;
    const { staleDecisionIds, currentDecisionIds } = await withOrgContext(
      this.db,
      orgId,
      async (tx) => {
        const links = await this.confirmedLinks(tx, input);
        await this.linkDecisions(tx, orgId, links);
        const current = await tx
          .select({ id: answerReadingDecisions.id })
          .from(answerReadingDecisions)
          .where(
            and(
              eq(answerReadingDecisions.orgId, orgId),
              inArray(answerReadingDecisions.markId, [...input.cropMarkIds]),
              isNull(answerReadingDecisions.supersededById),
            ),
          );
        const linked = new Set(input.links.map((link) => link.decisionId));
        return {
          staleDecisionIds: current.filter((row) => !linked.has(row.id)).map((row) => row.id),
          currentDecisionIds: current.map((row) => row.id),
        };
      },
    );
    const stale =
      staleDecisionIds.length === 0
        ? null
        : await this.consolidateDecisions(orgId, staleDecisionIds);
    const reviewed = await this.applyRecordedReviews(orgId, currentDecisionIds);
    if (this.isEmptyReport(reviewed)) return stale;
    return stale === null ? reviewed : this.mergeReports(stale, reviewed);
  }

  async applyRecordedReviews(
    orgId: string,
    decisionIds: readonly string[],
  ): Promise<ConsolidationReport> {
    const ids = [...new Set(decisionIds)];
    if (ids.length === 0) return this.emptyReport();
    const outcome = await withOrgContext(this.db, orgId, async (tx) => {
      const reviews = await this.decisions.activeReviewsByDecision(tx, orgId, ids);
      if (reviews.size === 0) return this.emptyOutcome();
      const { current, skipped } = await this.loadCurrentDecisions(tx, orgId, [...reviews.keys()]);
      const targets = await this.resolveTargets(tx, orgId, current);
      const context = await this.loadScoringContext(tx, current);
      const writes: ResponseWrite[] = [];
      const links: DecisionLink[] = [];
      const pending: string[] = [];
      for (const decision of current) {
        const review = reviews.get(decision.id);
        const target = targets.get(decision.id);
        if (!review || !target) {
          skipped.push({ decisionId: decision.id, reason: 'no_response' });
          continue;
        }
        if (this.hasForeignHumanScore(decision, target)) {
          skipped.push({ decisionId: decision.id, reason: 'human_scored' });
          links.push({ decisionId: decision.id, responseId: target.id, resolved: false });
          continue;
        }
        const resolution = this.resolutionOfReview(review);
        const write =
          resolution === null
            ? null
            : this.humanWrite(decision, target, resolution, review.reviewerId, context);
        if (write) {
          writes.push(write);
          continue;
        }
        pending.push(decision.id);
        links.push({ decisionId: decision.id, responseId: target.id, resolved: false });
        if (!target.isPending || target.hasHumanScore) {
          writes.push({
            ...this.pendingWrite(decision, target),
            respectHuman: false,
            clearHuman: true,
          });
        }
      }
      const written = await this.applyWrites(tx, orgId, writes, links);
      return {
        scored: written.scored,
        pending,
        skipped: [...skipped, ...written.skipped],
        assessmentIds: written.assessmentIds,
      };
    });
    return this.finish(orgId, outcome);
  }

  async revertHumanResolutions(
    orgId: string,
    decisionIds: readonly string[],
  ): Promise<ConsolidationReport> {
    const ids = [...new Set(decisionIds)];
    if (ids.length === 0) return this.emptyReport();
    const outcome = await withOrgContext(this.db, orgId, async (tx) => {
      const { current, skipped } = await this.loadCurrentDecisions(tx, orgId, ids);
      const targets = await this.resolveTargets(tx, orgId, current);
      const context = await this.loadScoringContext(tx, current);
      const writes: ResponseWrite[] = [];
      const pending: string[] = [];
      for (const decision of current) {
        const target = targets.get(decision.id);
        if (!target) {
          skipped.push({ decisionId: decision.id, reason: 'no_response' });
          continue;
        }
        if (this.hasForeignHumanScore(decision, target)) {
          skipped.push({ decisionId: decision.id, reason: 'human_scored' });
          continue;
        }
        const prescored = this.prescore(decision, context);
        if (prescored) {
          writes.push({
            ...this.automaticWrite(decision, target, prescored),
            respectHuman: false,
            clearHuman: true,
          });
          continue;
        }
        pending.push(decision.id);
        writes.push({
          ...this.pendingWrite(decision, target),
          respectHuman: false,
          clearHuman: true,
        });
      }
      const written = await this.applyWrites(tx, orgId, writes, []);
      return {
        scored: written.scored,
        pending,
        skipped: [...skipped, ...written.skipped],
        assessmentIds: written.assessmentIds,
      };
    });
    return this.finish(orgId, outcome);
  }

  async consolidateDecisions(
    orgId: string,
    decisionIds: readonly string[],
  ): Promise<ConsolidationReport> {
    const ids = [...new Set(decisionIds)];
    if (ids.length === 0) return this.emptyReport();
    const outcome = await withOrgContext(this.db, orgId, async (tx) => {
      const { current, skipped } = await this.loadCurrentDecisions(tx, orgId, ids);
      const targets = await this.resolveTargets(tx, orgId, current);
      const context = await this.loadScoringContext(tx, current);
      const writes: ResponseWrite[] = [];
      const links: DecisionLink[] = [];
      const pending: string[] = [];
      for (const decision of current) {
        const target = targets.get(decision.id);
        if (!target) {
          skipped.push({ decisionId: decision.id, reason: 'no_response' });
          continue;
        }
        if (target.hasHumanScore) {
          skipped.push({ decisionId: decision.id, reason: 'human_scored' });
          links.push({ decisionId: decision.id, responseId: target.id, resolved: false });
          continue;
        }
        const prescored = this.prescore(decision, context);
        if (prescored) {
          writes.push(this.automaticWrite(decision, target, prescored));
          continue;
        }
        pending.push(decision.id);
        links.push({ decisionId: decision.id, responseId: target.id, resolved: false });
        if (!target.isPending) writes.push(this.pendingWrite(decision, target));
      }
      const written = await this.applyWrites(tx, orgId, writes, links);
      return {
        scored: written.scored,
        pending: [...pending.filter((id) => !written.rejected.has(id))],
        skipped: [...skipped, ...written.skipped],
        assessmentIds: written.assessmentIds,
      };
    });
    return this.finish(orgId, outcome);
  }

  async applyHumanResolution(
    orgId: string,
    decisionId: string,
    resolution: HumanResolution,
    reviewerId: string,
  ): Promise<ConsolidationReport> {
    return this.applyHumanResolutions(orgId, [{ decisionId, resolution }], reviewerId);
  }

  async applyHumanResolutions(
    orgId: string,
    entries: readonly HumanResolutionEntry[],
    reviewerId: string,
  ): Promise<ConsolidationReport> {
    if (entries.length === 0) return this.emptyReport();
    const resolutionById = new Map(entries.map((entry) => [entry.decisionId, entry.resolution]));
    const outcome = await withOrgContext(this.db, orgId, async (tx) => {
      const { current, skipped } = await this.loadCurrentDecisions(tx, orgId, [
        ...resolutionById.keys(),
      ]);
      const targets = await this.resolveTargets(tx, orgId, current);
      const context = await this.loadScoringContext(tx, current);
      const writes: ResponseWrite[] = [];
      for (const decision of current) {
        const target = targets.get(decision.id);
        const resolution = resolutionById.get(decision.id);
        if (!target || !resolution) {
          skipped.push({ decisionId: decision.id, reason: 'no_response' });
          continue;
        }
        const write = this.humanWrite(decision, target, resolution, reviewerId, context);
        if (write) writes.push(write);
        else skipped.push({ decisionId: decision.id, reason: 'undecidable' });
      }
      const written = await this.applyWrites(tx, orgId, writes, []);
      return {
        scored: written.scored,
        pending: [],
        skipped: [...skipped, ...written.skipped],
        assessmentIds: written.assessmentIds,
      };
    });
    return this.finish(orgId, outcome);
  }

  private async finish(orgId: string, outcome: WriteOutcome): Promise<ConsolidationReport> {
    const recalculatedAssessmentIds =
      outcome.assessmentIds.length === 0
        ? []
        : await this.results.recalculateAnswerSheetResults(orgId, outcome.assessmentIds);
    return {
      scored: outcome.scored,
      pending: outcome.pending,
      skipped: outcome.skipped,
      recalculatedAssessmentIds,
    };
  }

  private emptyReport(): ConsolidationReport {
    return { scored: [], pending: [], skipped: [], recalculatedAssessmentIds: [] };
  }

  private emptyOutcome(): WriteOutcome {
    return { scored: [], pending: [], skipped: [], assessmentIds: [] };
  }

  private isEmptyReport(report: ConsolidationReport): boolean {
    return report.scored.length === 0 && report.pending.length === 0 && report.skipped.length === 0;
  }

  private mergeReports(left: ConsolidationReport, right: ConsolidationReport): ConsolidationReport {
    return {
      scored: [...left.scored, ...right.scored],
      pending: [...left.pending, ...right.pending],
      skipped: [...left.skipped, ...right.skipped],
      recalculatedAssessmentIds: [
        ...new Set([...left.recalculatedAssessmentIds, ...right.recalculatedAssessmentIds]),
      ],
    };
  }

  private resolutionOfReview(review: AnswerReview): HumanResolution | null {
    const reason = review.reason ?? undefined;
    switch (review.action) {
      case 'accept':
      case 'edit':
        return review.resultingValue !== null && review.resultingValue.canonical !== null
          ? { kind: 'reading', value: review.resultingValue, reason }
          : null;
      case 'illegible':
      case 'blank':
      case 'crossed_out':
        return { kind: review.action };
      case 'mark_correct':
        return { kind: 'grading', isCorrect: true, reason };
      case 'mark_incorrect':
        return { kind: 'grading', isCorrect: false, reason };
      case 'undo':
        return null;
    }
  }

  private hasForeignHumanScore(decision: AnswerReadingDecision, target: TargetResponse): boolean {
    return target.hasHumanScore && target.writtenByDecisionId !== decision.id;
  }

  private writtenByDecisionId(value: unknown): string | null {
    if (value === null || typeof value !== 'object') return null;
    const reading = (value as { reading?: unknown }).reading;
    if (reading === null || typeof reading !== 'object') return null;
    const decisionId = (reading as { decisionId?: unknown }).decisionId;
    return typeof decisionId === 'string' ? decisionId : null;
  }

  private async loadCurrentDecisions(
    tx: Database,
    orgId: string,
    decisionIds: readonly string[],
  ): Promise<{ current: AnswerReadingDecision[]; skipped: ConsolidationSkip[] }> {
    const rows = await tx
      .select()
      .from(answerReadingDecisions)
      .where(
        and(
          eq(answerReadingDecisions.orgId, orgId),
          inArray(answerReadingDecisions.id, [...decisionIds]),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const current: AnswerReadingDecision[] = [];
    const skipped: ConsolidationSkip[] = [];
    for (const decisionId of decisionIds) {
      const decision = byId.get(decisionId);
      if (decision && decision.supersededById === null) current.push(decision);
      else skipped.push({ decisionId, reason: 'not_current' });
    }
    return { current, skipped };
  }

  private async loadScoringContext(
    tx: Database,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<ScoringContext> {
    if (decisions.length === 0) return { items: new Map(), readings: new Map() };
    const itemIds = [...new Set(decisions.map((decision) => decision.itemId))];
    const readingIds = new Set<string>();
    for (const decision of decisions) {
      for (const readingId of decision.usedReadingIds) readingIds.add(readingId);
    }
    const itemRows = await tx
      .select({
        id: items.id,
        type: items.type,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(inArray(items.id, itemIds));
    const readingRows =
      readingIds.size === 0
        ? []
        : await tx
            .select({
              id: answerReadings.id,
              confidence: answerReadings.confidence,
              model: answerReadings.model,
              promptRef: answerReadings.promptRef,
            })
            .from(answerReadings)
            .where(inArray(answerReadings.id, [...readingIds]));
    return {
      items: new Map(itemRows.map((row) => [row.id, toReadingScoringItem(row)])),
      readings: new Map(
        readingRows.map((row) => [
          row.id,
          {
            confidence: row.confidence === null ? null : Number(row.confidence),
            model: row.model,
            promptRef: row.promptRef,
          },
        ]),
      ),
    };
  }

  private prescore(
    decision: AnswerReadingDecision,
    context: ScoringContext,
  ): PrescoredAnswer | null {
    if (decision.outcome === 'auto_blank') {
      return {
        itemId: decision.itemId,
        value: this.readingValue(null, null, decision.id),
        isCorrect: false,
        rawScore: 0,
        scoredBy: 'auto',
        aiScore: null,
      };
    }
    if (decision.outcome !== 'auto_accepted' || decision.value === null) return null;
    const item = context.items.get(decision.itemId);
    if (!item) return null;
    const scored = this.scoreValue(item, decision.value);
    if (!scored) return null;
    return {
      itemId: decision.itemId,
      value: this.readingValue(scored.answer, decision.value.canonical, decision.id),
      isCorrect: scored.isCorrect,
      rawScore: scored.rawScore,
      scoredBy: 'ai',
      aiScore: this.aiScoreOf(decision, scored.rawScore, context.readings),
    };
  }

  private scoreValue(item: ReadingScoringItem, value: NormalizedAnswer): ScoredValue | null {
    const scored = scoreReadingValue(item, value);
    if (!scored) return null;
    const { output } = scored;
    if (output.requiresManualGrading || output.isCorrect === null) return null;
    return { answer: scored.answer, isCorrect: output.isCorrect, rawScore: output.rawScore ?? 0 };
  }

  private aiScoreOf(
    decision: AnswerReadingDecision,
    score: number,
    readings: ReadonlyMap<string, ReadingSummary>,
  ): ResponseAiScore {
    const confidences: number[] = [];
    const models = new Set<string>();
    const prompts = new Set<string>();
    for (const readingId of decision.usedReadingIds) {
      const reading = readings.get(readingId);
      if (!reading) continue;
      if (reading.confidence !== null) confidences.push(reading.confidence);
      models.add(reading.model);
      prompts.add(reading.promptRef);
    }
    return {
      score,
      ...(confidences.length > 0 ? { confidence: Math.min(...confidences) } : {}),
      ...(models.size > 0 ? { model: [...models].join('+') } : {}),
      ...(prompts.size > 0 ? { promptVersion: [...prompts].join('+') } : {}),
      decisionId: decision.id,
    };
  }

  private readingValue(
    answer: unknown,
    canonical: string | null,
    decisionId: string,
  ): Record<string, unknown> {
    return { answer, reading: { canonical, decisionId } };
  }

  private automaticWrite(
    decision: AnswerReadingDecision,
    target: TargetResponse,
    prescored: PrescoredAnswer,
  ): ResponseWrite {
    return {
      decisionId: decision.id,
      responseId: target.id,
      assessmentId: target.assessmentId,
      value: prescored.value,
      isCorrect: prescored.isCorrect,
      rawScore: prescored.rawScore,
      scoredBy: prescored.scoredBy,
      aiScore: prescored.aiScore,
      humanScore: null,
      respectHuman: true,
    };
  }

  private pendingWrite(decision: AnswerReadingDecision, target: TargetResponse): ResponseWrite {
    return {
      decisionId: decision.id,
      responseId: target.id,
      assessmentId: target.assessmentId,
      value: { ...PENDING_READING_VALUE },
      isCorrect: null,
      rawScore: null,
      scoredBy: 'human',
      aiScore: null,
      humanScore: null,
      respectHuman: true,
    };
  }

  private humanWrite(
    decision: AnswerReadingDecision,
    target: TargetResponse,
    resolution: HumanResolution,
    reviewerId: string,
    context: ScoringContext,
  ): ResponseWrite | null {
    const item = context.items.get(decision.itemId);
    if (!item) return null;
    const base = {
      decisionId: decision.id,
      responseId: target.id,
      assessmentId: target.assessmentId,
      scoredBy: 'human' as const,
      aiScore: null,
      respectHuman: false,
    };
    if (
      resolution.kind !== 'reading' &&
      resolution.kind !== 'grading' &&
      resolution.kind !== 'rubric'
    ) {
      const unanswered = UNANSWERED_RESOLUTIONS[resolution.kind];
      return {
        ...base,
        value: { ...this.readingValue(null, null, decision.id), [unanswered.flag]: true },
        isCorrect: false,
        rawScore: 0,
        humanScore: {
          score: 0,
          scoredById: reviewerId,
          overrideReason: unanswered.overrideReason,
        },
      };
    }
    if (resolution.kind === 'reading') {
      const scored = this.scoreValue(item, resolution.value);
      if (!scored) return null;
      return {
        ...base,
        value: this.readingValue(scored.answer, resolution.value.canonical, decision.id),
        isCorrect: scored.isCorrect,
        rawScore: scored.rawScore,
        humanScore: this.humanScoreOf(scored.rawScore, reviewerId, resolution.reason),
      };
    }
    const score = Math.min(
      Math.max(resolution.score ?? (resolution.isCorrect ? item.maxScore : 0), 0),
      item.maxScore,
    );
    const answer =
      decision.value !== null && isSupportedFormatKind(decision.value.formatKind)
        ? toScoringInput(decision.value)
        : null;
    const levelCode = resolution.kind === 'rubric' ? resolution.levelCode : undefined;
    const value = this.readingValue(answer, decision.canonical, decision.id);
    return {
      ...base,
      value: levelCode === undefined ? value : { ...value, rubricLevel: levelCode },
      isCorrect: resolution.isCorrect,
      rawScore: score,
      humanScore: this.humanScoreOf(score, reviewerId, resolution.reason, levelCode),
    };
  }

  private humanScoreOf(
    score: number,
    reviewerId: string,
    reason: string | undefined,
    levelCode?: string,
  ): ResponseHumanScore {
    return {
      score,
      scoredById: reviewerId,
      ...(reason !== undefined && reason.trim().length > 0 ? { overrideReason: reason } : {}),
      ...(levelCode !== undefined ? { levelCode } : {}),
    };
  }

  private async resolveTargets(
    tx: Database,
    orgId: string,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<Map<string, TargetResponse>> {
    const responseIdByDecision = new Map<string, string>();
    const unlinked: AnswerReadingDecision[] = [];
    for (const decision of decisions) {
      if (decision.responseId !== null) responseIdByDecision.set(decision.id, decision.responseId);
      else unlinked.push(decision);
    }
    if (unlinked.length > 0) {
      const inherited = await this.inheritedResponseIds(tx, orgId, unlinked);
      const orphans: AnswerReadingDecision[] = [];
      for (const decision of unlinked) {
        const responseId = inherited.get(decision.markId);
        if (responseId) responseIdByDecision.set(decision.id, responseId);
        else orphans.push(decision);
      }
      const confirmed = await this.confirmedBatchResponseIds(tx, orgId, orphans);
      for (const [decisionId, responseId] of confirmed) {
        responseIdByDecision.set(decisionId, responseId);
      }
    }
    if (responseIdByDecision.size === 0) return new Map();
    const responseRows = await tx
      .select({
        id: responses.id,
        assessmentId: responses.assessmentId,
        humanScore: responses.humanScore,
        finalScore: responses.finalScore,
        value: responses.value,
      })
      .from(responses)
      .where(inArray(responses.id, [...new Set(responseIdByDecision.values())]));
    const responseById = new Map(responseRows.map((row) => [row.id, row]));
    const targets = new Map<string, TargetResponse>();
    for (const [decisionId, responseId] of responseIdByDecision) {
      const row = responseById.get(responseId);
      if (!row) continue;
      targets.set(decisionId, {
        id: row.id,
        assessmentId: row.assessmentId,
        hasHumanScore: row.humanScore !== null,
        isPending: row.finalScore === null,
        writtenByDecisionId: this.writtenByDecisionId(row.value),
      });
    }
    return targets;
  }

  private async inheritedResponseIds(
    tx: Database,
    orgId: string,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<Map<string, string>> {
    const rows = await tx
      .select({
        markId: answerReadingDecisions.markId,
        responseId: answerReadingDecisions.responseId,
      })
      .from(answerReadingDecisions)
      .where(
        and(
          eq(answerReadingDecisions.orgId, orgId),
          inArray(answerReadingDecisions.markId, [
            ...new Set(decisions.map((decision) => decision.markId)),
          ]),
          isNotNull(answerReadingDecisions.responseId),
        ),
      )
      .orderBy(desc(answerReadingDecisions.createdAt));
    const byMark = new Map<string, string>();
    for (const row of rows) {
      if (row.responseId !== null && !byMark.has(row.markId))
        byMark.set(row.markId, row.responseId);
    }
    return byMark;
  }

  private async confirmedBatchResponseIds(
    tx: Database,
    orgId: string,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<Map<string, string>> {
    if (decisions.length === 0) return new Map();
    const marks = await tx
      .select({ id: sheetScanMarks.id, scanId: sheetScanMarks.scanId })
      .from(sheetScanMarks)
      .where(
        and(
          eq(sheetScanMarks.orgId, orgId),
          inArray(
            sheetScanMarks.id,
            decisions.map((decision) => decision.markId),
          ),
        ),
      );
    if (marks.length === 0) return new Map();
    const scans = await tx
      .select({
        id: sheetScans.id,
        batchId: sheetScans.batchId,
        state: sheetScans.state,
        resolvedStudentId: sheetScans.resolvedStudentId,
        printedSheetId: sheetScans.printedSheetId,
      })
      .from(sheetScans)
      .where(
        and(
          eq(sheetScans.orgId, orgId),
          inArray(sheetScans.id, [...new Set(marks.map((mark) => mark.scanId))]),
        ),
      );
    const liveScans = scans.filter((scan) => scan.state !== 'superseded');
    if (liveScans.length === 0) return new Map();
    const batches = await tx
      .select({ id: sheetScanBatches.id, printRunId: sheetScanBatches.printRunId })
      .from(sheetScanBatches)
      .where(
        and(
          eq(sheetScanBatches.orgId, orgId),
          eq(sheetScanBatches.status, 'confirmed'),
          inArray(sheetScanBatches.id, [...new Set(liveScans.map((scan) => scan.batchId))]),
        ),
      );
    if (batches.length === 0) return new Map();
    const printRuns = await tx
      .select({ id: sheetPrintRuns.id, assessmentId: sheetPrintRuns.assessmentId })
      .from(sheetPrintRuns)
      .where(
        and(
          eq(sheetPrintRuns.orgId, orgId),
          inArray(sheetPrintRuns.id, [...new Set(batches.map((batch) => batch.printRunId))]),
        ),
      );
    const sheetIds = liveScans
      .filter((scan) => scan.resolvedStudentId === null && scan.printedSheetId !== null)
      .map((scan) => scan.printedSheetId as string);
    const sheets =
      sheetIds.length === 0
        ? []
        : await tx
            .select({ id: printedSheets.id, studentId: printedSheets.studentId })
            .from(printedSheets)
            .where(and(eq(printedSheets.orgId, orgId), inArray(printedSheets.id, sheetIds)));

    const scanIdByMark = new Map(marks.map((mark) => [mark.id, mark.scanId]));
    const scanById = new Map(liveScans.map((scan) => [scan.id, scan]));
    const printRunByBatch = new Map(batches.map((batch) => [batch.id, batch.printRunId]));
    const assessmentByPrintRun = new Map(printRuns.map((run) => [run.id, run.assessmentId]));
    const studentBySheet = new Map(sheets.map((sheet) => [sheet.id, sheet.studentId]));

    const keyByDecision = new Map<string, string>();
    const assessmentIds = new Set<string>();
    const studentIds = new Set<string>();
    for (const decision of decisions) {
      const scanId = scanIdByMark.get(decision.markId);
      const scan = scanId === undefined ? undefined : scanById.get(scanId);
      if (!scan) continue;
      const printRunId = printRunByBatch.get(scan.batchId);
      const assessmentId =
        printRunId === undefined ? null : (assessmentByPrintRun.get(printRunId) ?? null);
      const studentId =
        scan.resolvedStudentId ??
        (scan.printedSheetId === null ? null : (studentBySheet.get(scan.printedSheetId) ?? null));
      if (assessmentId === null || studentId === null) continue;
      keyByDecision.set(decision.id, this.responseKey(assessmentId, studentId, decision.itemId));
      assessmentIds.add(assessmentId);
      studentIds.add(studentId);
    }
    if (keyByDecision.size === 0) return new Map();

    const responseRows = await tx
      .select({
        id: responses.id,
        assessmentId: responses.assessmentId,
        studentId: responses.studentId,
        itemId: responses.itemId,
      })
      .from(responses)
      .where(
        and(
          inArray(responses.assessmentId, [...assessmentIds]),
          inArray(responses.studentId, [...studentIds]),
          inArray(responses.itemId, [...new Set(decisions.map((decision) => decision.itemId))]),
        ),
      );
    const responseIdByKey = new Map(
      responseRows.map((row) => [
        this.responseKey(row.assessmentId, row.studentId, row.itemId),
        row.id,
      ]),
    );
    const found = new Map<string, string>();
    for (const [decisionId, key] of keyByDecision) {
      const responseId = responseIdByKey.get(key);
      if (responseId) found.set(decisionId, responseId);
    }
    return found;
  }

  private async confirmedLinks(
    tx: Database,
    input: ConfirmedReadingsInput,
  ): Promise<DecisionLink[]> {
    if (input.links.length === 0) return [];
    const rows = await tx
      .select({
        id: responses.id,
        studentId: responses.studentId,
        itemId: responses.itemId,
        finalScore: responses.finalScore,
      })
      .from(responses)
      .where(
        and(
          eq(responses.assessmentId, input.assessmentId),
          inArray(responses.studentId, [...new Set(input.links.map((link) => link.studentId))]),
          inArray(responses.itemId, [...new Set(input.links.map((link) => link.itemId))]),
        ),
      );
    const responseByKey = new Map(
      rows.map((row) => [this.responseKey(input.assessmentId, row.studentId, row.itemId), row]),
    );
    const links: DecisionLink[] = [];
    for (const link of input.links) {
      const response = responseByKey.get(
        this.responseKey(input.assessmentId, link.studentId, link.itemId),
      );
      if (!response) continue;
      links.push({
        decisionId: link.decisionId,
        responseId: response.id,
        resolved: link.consolidated && response.finalScore !== null,
      });
    }
    return links;
  }

  private responseKey(assessmentId: string, studentId: string, itemId: string): string {
    return `${assessmentId}|${studentId}|${itemId}`;
  }

  private async applyWrites(
    tx: Database,
    orgId: string,
    writes: readonly ResponseWrite[],
    links: readonly DecisionLink[],
  ): Promise<{
    scored: string[];
    skipped: ConsolidationSkip[];
    rejected: Set<string>;
    assessmentIds: string[];
  }> {
    const applied = await this.writeResponses(tx, writes);
    const scored: string[] = [];
    const skipped: ConsolidationSkip[] = [];
    const rejected = new Set<string>();
    const assessmentIds = new Set<string>();
    const allLinks = [...links];
    for (const write of writes) {
      const wasApplied = applied.has(write.responseId);
      if (wasApplied) assessmentIds.add(write.assessmentId);
      else {
        rejected.add(write.decisionId);
        skipped.push({ decisionId: write.decisionId, reason: 'human_scored' });
      }
      if (wasApplied && write.isCorrect !== null) scored.push(write.decisionId);
      if (write.isCorrect !== null) {
        allLinks.push({
          decisionId: write.decisionId,
          responseId: write.responseId,
          resolved: wasApplied,
        });
      }
    }
    await this.linkDecisions(tx, orgId, allLinks);
    return { scored, skipped, rejected, assessmentIds: [...assessmentIds] };
  }

  private async writeResponses(
    tx: Database,
    writes: readonly ResponseWrite[],
  ): Promise<Set<string>> {
    if (writes.length === 0) return new Set();
    const payload = writes.map((write) => ({
      id: write.responseId,
      value: write.value,
      is_correct: write.isCorrect,
      raw_score: write.rawScore === null ? null : write.rawScore.toFixed(2),
      scored_by: write.scoredBy,
      scored: write.isCorrect !== null,
      ai_score: write.aiScore,
      human_score: write.humanScore,
      respect_human: write.respectHuman,
      clear_human: write.clearHuman === true,
    }));
    const rows = (await tx.execute(sql`
      UPDATE responses AS r
      SET value = v.value,
          is_correct = v.is_correct,
          raw_score = v.raw_score,
          final_score = v.raw_score,
          scored_by = v.scored_by,
          scored_at = CASE WHEN v.scored THEN now() ELSE NULL END,
          ai_score = COALESCE(v.ai_score, r.ai_score),
          human_score = CASE WHEN v.clear_human THEN NULL ELSE COALESCE(v.human_score, r.human_score) END,
          updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS v(
        id uuid,
        value jsonb,
        is_correct boolean,
        raw_score numeric,
        scored_by scored_by,
        scored boolean,
        ai_score jsonb,
        human_score jsonb,
        respect_human boolean,
        clear_human boolean
      )
      WHERE r.id = v.id AND (NOT v.respect_human OR r.human_score IS NULL)
      RETURNING r.id
    `)) as unknown as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  private async linkDecisions(
    tx: Database,
    orgId: string,
    links: readonly DecisionLink[],
  ): Promise<void> {
    if (links.length === 0) return;
    const payload = links.map((link) => ({
      id: link.decisionId,
      response_id: link.responseId,
      resolved: link.resolved,
    }));
    await tx.execute(sql`
      UPDATE answer_reading_decisions AS d
      SET response_id = v.response_id,
          resolved_at = CASE WHEN v.resolved THEN now() ELSE d.resolved_at END,
          updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS v(
        id uuid,
        response_id uuid,
        resolved boolean
      )
      WHERE d.id = v.id AND d.org_id = ${orgId}
    `);
  }
}
