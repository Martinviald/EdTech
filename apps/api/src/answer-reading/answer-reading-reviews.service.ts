import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  answerReadingDecisions,
  answerReadings,
  answerReadingSamples,
  answerReviews,
  assessments,
  instruments,
  items,
  organizations,
  sheetScanMarks,
  withOrgContext,
  type AnswerReadingDecision,
  type AnswerReview,
  type NewAnswerReadingSample,
  type NewAnswerReview,
} from '@soe/db';
import {
  REVIEW_ACTIONS_BY_MODE,
  resolveAnswerReadingSettings,
  type NormalizedAnswer,
  type ReadingState,
  type ResponseFormat,
  type ReviewAction,
  type SampleConsentScope,
  type SampleSplit,
  type SubmitReviewDto,
  type SubmitReviewResult,
  type UndoReviewsDto,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import {
  AnswerReadingConsolidationService,
  type ConsolidationReport,
} from './answer-reading-consolidation.service';
import { AnswerReadingDecisionsService } from './answer-reading-decisions.service';
import {
  decisionResponseFormat,
  formatLabelOf,
  normalizeLiteral,
  pendingReviewOf,
} from './answer-reading-review.helpers';
import { toReadingScoringItem, type ReadingScoringItem } from './answer-reading-scoring.helpers';

interface ReviewContext {
  readonly decisions: AnswerReadingDecision[];
  readonly itemById: ReadonlyMap<string, ReadingScoringItem>;
  readonly activeReviews: ReadonlyMap<string, AnswerReview>;
  readonly openReviewsByDecision: ReadonlyMap<string, string[]>;
  readonly formatByDecision: ReadonlyMap<string, ResponseFormat>;
  readonly literalsByDecision: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly cropFileByMark: ReadonlyMap<string, string | null>;
}

interface ReviewOutcome {
  readonly resultingValue: NormalizedAnswer | null;
  readonly editedLiteral: string | null;
}

interface SampleContext {
  readonly consentScope: SampleConsentScope;
  readonly subjectId: string | null;
  readonly gradeId: string | null;
}

const UNANSWERED_STATES: Partial<Record<ReviewAction, ReadingState>> = {
  illegible: 'illegible',
  blank: 'blank',
  crossed_out: 'crossed_out_only',
};
const READING_VALUE_ACTIONS: ReadonlySet<ReviewAction> = new Set(['accept', 'edit']);
const NOT_FOUND_MESSAGE = 'Una o más respuestas no existen en tu organización';
const TRAIN_SHARE = 70;
const VALIDATION_SHARE = 85;

@Injectable()
export class AnswerReadingReviewsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly decisions: AnswerReadingDecisionsService,
    private readonly consolidation: AnswerReadingConsolidationService,
  ) {}

  async submit(
    orgId: string,
    reviewerId: string,
    dto: SubmitReviewDto,
  ): Promise<SubmitReviewResult> {
    this.assertActionAllowed(dto);
    const decisionIds = [...new Set(dto.decisionIds)];
    const reviewIds = await withOrgContext(this.db, orgId, async (tx) => {
      const context = await this.loadContext(tx, orgId, decisionIds);
      this.assertModeMatches(dto, context);
      const groupOperationId = randomUUID();
      const now = new Date();
      const rows: NewAnswerReview[] = context.decisions.map((decision) => {
        const outcome = this.outcomeOf(dto, decision, context);
        return {
          id: randomUUID(),
          orgId,
          decisionId: decision.id,
          reviewerId,
          mode: dto.mode,
          action: dto.action,
          editedLiteral: outcome.editedLiteral,
          resultingCanonical: outcome.resultingValue?.canonical ?? null,
          resultingValue: outcome.resultingValue,
          reason: dto.reason?.trim() ? dto.reason.trim() : null,
          groupOperationId,
          groupSize: decisionIds.length,
          createdAt: now,
        };
      });
      await tx.insert(answerReviews).values(rows);
      await this.supersedeReviews(tx, orgId, this.supersessions(rows, context));
      await this.recordSamples(tx, orgId, rows, context);
      return rows.map((row) => row.id as string);
    });
    const report = await this.consolidation.applyRecordedReviews(orgId, decisionIds);
    return { reviewIds, ...this.reportSummary(report, report.scored) };
  }

  async undo(orgId: string, reviewerId: string, dto: UndoReviewsDto): Promise<SubmitReviewResult> {
    const ids = [...new Set(dto.reviewIds)];
    const { undoIds, decisionIds } = await withOrgContext(this.db, orgId, async (tx) => {
      const reviews = await tx
        .select()
        .from(answerReviews)
        .where(and(eq(answerReviews.orgId, orgId), inArray(answerReviews.id, ids)));
      if (reviews.length !== ids.length) {
        throw new NotFoundException('Una o más revisiones no existen en tu organización');
      }
      if (reviews.some((review) => review.action === 'undo')) {
        throw new BadRequestException('Una acción de deshacer no se puede deshacer');
      }
      if (reviews.some((review) => review.supersededById !== null)) {
        throw new ConflictException(
          'Una o más revisiones ya fueron reemplazadas o deshechas; recarga la cola',
        );
      }
      const groupOperationId = randomUUID();
      const now = new Date();
      const undoRows: NewAnswerReview[] = reviews.map((review) => ({
        id: randomUUID(),
        orgId,
        decisionId: review.decisionId,
        reviewerId,
        mode: review.mode,
        action: 'undo',
        groupOperationId,
        groupSize: reviews.length,
        createdAt: now,
      }));
      await tx.insert(answerReviews).values(undoRows);
      await this.supersedeReviews(
        tx,
        orgId,
        reviews.map((review, index) => ({ id: review.id, supersededById: undoRows[index]?.id })),
      );
      await tx
        .update(answerReadingSamples)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(answerReadingSamples.orgId, orgId),
            inArray(answerReadingSamples.reviewId, ids),
            isNull(answerReadingSamples.deletedAt),
          ),
        );
      return {
        undoIds: undoRows.map((row) => row.id as string),
        decisionIds: [...new Set(reviews.map((review) => review.decisionId))],
      };
    });
    const report = await this.consolidation.revertHumanResolutions(orgId, decisionIds);
    return {
      reviewIds: undoIds,
      ...this.reportSummary(report, [...report.scored, ...report.pending]),
    };
  }

  private assertActionAllowed(dto: SubmitReviewDto): void {
    const allowed: readonly ReviewAction[] = REVIEW_ACTIONS_BY_MODE[dto.mode];
    if (!allowed.includes(dto.action)) {
      throw new BadRequestException('La acción no corresponde al modo de revisión');
    }
    if (dto.action === 'undo') {
      throw new BadRequestException('Para deshacer usa POST /answer-reading/reviews/undo');
    }
  }

  private assertModeMatches(dto: SubmitReviewDto, context: ReviewContext): void {
    if (dto.mode !== 'grading') return;
    for (const decision of context.decisions) {
      const pending = pendingReviewOf(
        decision,
        context.activeReviews.get(decision.id),
        context.itemById.get(decision.itemId),
      );
      if (pending?.mode === 'reading') {
        throw new BadRequestException(
          'Primero resuelve qué escribió el alumno: esta respuesta está en revisión de lectura',
        );
      }
    }
  }

  private async loadContext(
    tx: Database,
    orgId: string,
    decisionIds: readonly string[],
  ): Promise<ReviewContext> {
    const decisions = await tx
      .select()
      .from(answerReadingDecisions)
      .where(
        and(
          eq(answerReadingDecisions.orgId, orgId),
          inArray(answerReadingDecisions.id, [...decisionIds]),
        ),
      );
    if (decisions.length !== decisionIds.length) throw new NotFoundException(NOT_FOUND_MESSAGE);
    if (decisions.some((decision) => decision.supersededById !== null)) {
      throw new ConflictException(
        'Una o más respuestas se volvieron a leer mientras revisabas; recarga la cola',
      );
    }
    const itemRows = await tx
      .select({
        id: items.id,
        type: items.type,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(inArray(items.id, [...new Set(decisions.map((decision) => decision.itemId))]));
    const markIds = [...new Set(decisions.map((decision) => decision.markId))];
    const marks = await tx
      .select({ id: sheetScanMarks.id, cropFileId: sheetScanMarks.cropFileId })
      .from(sheetScanMarks)
      .where(and(eq(sheetScanMarks.orgId, orgId), inArray(sheetScanMarks.id, markIds)));
    const readings = await tx
      .select({
        markId: answerReadings.markId,
        responseFormat: answerReadings.responseFormat,
        literal: answerReadings.literal,
        normalized: answerReadings.normalized,
      })
      .from(answerReadings)
      .where(and(eq(answerReadings.orgId, orgId), inArray(answerReadings.markId, markIds)));
    const openReviews = await tx
      .select({ id: answerReviews.id, decisionId: answerReviews.decisionId })
      .from(answerReviews)
      .where(
        and(
          eq(answerReviews.orgId, orgId),
          inArray(answerReviews.decisionId, [...decisionIds]),
          isNull(answerReviews.supersededById),
        ),
      );
    const itemById = new Map(itemRows.map((row) => [row.id, toReadingScoringItem(row)]));
    const snapshotByMark = new Map<string, ResponseFormat>();
    const literalsByMark = new Map<string, Map<string, string>>();
    for (const reading of readings) {
      if (!snapshotByMark.has(reading.markId)) {
        snapshotByMark.set(reading.markId, reading.responseFormat);
      }
      const canonical = reading.normalized?.canonical;
      if (canonical == null || reading.literal === null) continue;
      let literals = literalsByMark.get(reading.markId);
      if (!literals) {
        literals = new Map();
        literalsByMark.set(reading.markId, literals);
      }
      if (!literals.has(canonical)) literals.set(canonical, reading.literal);
    }
    const formatByDecision = new Map<string, ResponseFormat>();
    const literalsByDecision = new Map<string, ReadonlyMap<string, string>>();
    for (const decision of decisions) {
      formatByDecision.set(
        decision.id,
        decisionResponseFormat(snapshotByMark.get(decision.markId), itemById.get(decision.itemId)),
      );
      literalsByDecision.set(decision.id, literalsByMark.get(decision.markId) ?? new Map());
    }
    const openReviewsByDecision = new Map<string, string[]>();
    for (const review of openReviews) {
      let list = openReviewsByDecision.get(review.decisionId);
      if (!list) {
        list = [];
        openReviewsByDecision.set(review.decisionId, list);
      }
      list.push(review.id);
    }
    return {
      decisions,
      itemById,
      activeReviews: await this.decisions.activeReviewsByDecision(tx, orgId, decisionIds),
      openReviewsByDecision,
      formatByDecision,
      literalsByDecision,
      cropFileByMark: new Map(marks.map((mark) => [mark.id, mark.cropFileId])),
    };
  }

  private outcomeOf(
    dto: SubmitReviewDto,
    decision: AnswerReadingDecision,
    context: ReviewContext,
  ): ReviewOutcome {
    const format = context.formatByDecision.get(decision.id);
    const editedLiteral = dto.editedLiteral?.trim() ? dto.editedLiteral.trim() : null;
    const unansweredState = UNANSWERED_STATES[dto.action];
    if (unansweredState !== undefined) {
      return {
        editedLiteral: null,
        resultingValue: {
          formatKind: format?.kind ?? decision.value?.formatKind ?? 'short_text',
          state: unansweredState,
          canonical: null,
          value: null,
          issues: [],
        },
      };
    }
    if (dto.action === 'mark_correct' || dto.action === 'mark_incorrect') {
      const active = context.activeReviews.get(decision.id);
      return { editedLiteral: null, resultingValue: active?.resultingValue ?? decision.value };
    }
    if (editedLiteral === null) {
      if (decision.value === null) {
        throw new BadRequestException(
          'Esta respuesta no tiene una lectura propuesta para aceptar; escribe lo que dice',
        );
      }
      return { editedLiteral: null, resultingValue: decision.value };
    }
    const normalized = format ? normalizeLiteral(editedLiteral, format) : null;
    if (normalized === null) {
      throw new BadRequestException(
        'Esta respuesta tiene un formato que todavía no admite edición en la revisión',
      );
    }
    if (dto.action === 'edit' && normalized.canonical === null && format) {
      throw new BadRequestException(
        `No se pudo interpretar "${editedLiteral}" como ${formatLabelOf(format)}. Revisa cómo la escribiste.`,
      );
    }
    return { editedLiteral, resultingValue: normalized };
  }

  private supersessions(
    rows: readonly NewAnswerReview[],
    context: ReviewContext,
  ): Array<{ id: string; supersededById: string | undefined }> {
    const pairs: Array<{ id: string; supersededById: string | undefined }> = [];
    for (const row of rows) {
      for (const previousId of context.openReviewsByDecision.get(row.decisionId) ?? []) {
        pairs.push({ id: previousId, supersededById: row.id });
      }
    }
    return pairs;
  }

  private async supersedeReviews(
    tx: Database,
    orgId: string,
    pairs: ReadonlyArray<{ id: string; supersededById: string | undefined }>,
  ): Promise<void> {
    const payload = pairs
      .filter((pair) => pair.supersededById !== undefined)
      .map((pair) => ({ id: pair.id, superseded_by_id: pair.supersededById }));
    if (payload.length === 0) return;
    await tx.execute(sql`
      UPDATE answer_reviews AS r
      SET superseded_by_id = v.superseded_by_id
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS v(
        id uuid,
        superseded_by_id uuid
      )
      WHERE r.id = v.id AND r.org_id = ${orgId} AND r.superseded_by_id IS NULL
    `);
  }

  private async recordSamples(
    tx: Database,
    orgId: string,
    rows: readonly NewAnswerReview[],
    context: ReviewContext,
  ): Promise<void> {
    const sampleContext = await this.sampleContext(tx, orgId, context.decisions);
    if (sampleContext === null) return;
    const decisionById = new Map(context.decisions.map((decision) => [decision.id, decision]));
    const samples: NewAnswerReadingSample[] = [];
    for (const row of rows) {
      const decision = decisionById.get(row.decisionId);
      if (!decision) continue;
      const sample = this.sampleOf(orgId, row, decision, context, sampleContext);
      if (sample) samples.push(sample);
    }
    if (samples.length > 0) await tx.insert(answerReadingSamples).values(samples);
  }

  private async sampleContext(
    tx: Database,
    orgId: string,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<SampleContext | null> {
    const [org] = await tx
      .select({ config: organizations.config })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const { datasetConsent } = resolveAnswerReadingSettings(org?.config ?? null);
    if (datasetConsent === 'none') return null;
    const assessmentId = decisions.find((decision) => decision.assessmentId !== null)?.assessmentId;
    const instrument = assessmentId ? await this.instrumentOf(tx, orgId, assessmentId) : null;
    return {
      consentScope: datasetConsent,
      subjectId: instrument?.subjectId ?? null,
      gradeId: instrument?.gradeId ?? null,
    };
  }

  private async instrumentOf(
    tx: Database,
    orgId: string,
    assessmentId: string,
  ): Promise<{ subjectId: string | null; gradeId: string | null } | null> {
    const [assessment] = await tx
      .select({ instrumentId: assessments.instrumentId })
      .from(assessments)
      .where(and(eq(assessments.orgId, orgId), eq(assessments.id, assessmentId)))
      .limit(1);
    if (!assessment) return null;
    const [instrument] = await tx
      .select({ subjectId: instruments.subjectId, gradeId: instruments.gradeId })
      .from(instruments)
      .where(eq(instruments.id, assessment.instrumentId))
      .limit(1);
    return instrument ?? null;
  }

  private sampleOf(
    orgId: string,
    row: NewAnswerReview,
    decision: AnswerReadingDecision,
    context: ReviewContext,
    sampleContext: SampleContext,
  ): NewAnswerReadingSample | null {
    const needsNormalizerCase =
      row.action === 'mark_correct' && decision.reasons.includes('unparsed_format');
    if (row.mode !== 'reading' && !needsNormalizerCase) return null;
    const cropFileId = context.cropFileByMark.get(decision.markId) ?? null;
    if (cropFileId === null) return null;
    const value = row.resultingValue ?? null;
    const canonical = value?.canonical ?? null;
    const literal =
      row.editedLiteral ??
      (canonical === null ? null : context.literalsByDecision.get(decision.id)?.get(canonical)) ??
      canonical ??
      '';
    const format = context.formatByDecision.get(decision.id);
    return {
      orgId,
      decisionId: decision.id,
      reviewId: row.id,
      itemId: decision.itemId,
      formatKind: format?.kind ?? value?.formatKind ?? 'short_text',
      subjectId: sampleContext.subjectId,
      gradeId: sampleContext.gradeId,
      cropFileId,
      labelState: value?.state ?? 'answered',
      labelLiteral: READING_VALUE_ACTIONS.has(row.action) || needsNormalizerCase ? literal : '',
      labelCanonical: canonical,
      labelSource: row.mode === 'reading' ? 'review_reading' : 'review_grading',
      split: this.splitOf(decision.id),
      consentScope: sampleContext.consentScope,
      needsNormalizerCase,
    };
  }

  private splitOf(decisionId: string): SampleSplit {
    const bucket = (createHash('sha256').update(decisionId).digest()[0] ?? 0) % 100;
    if (bucket < TRAIN_SHARE) return 'train';
    return bucket < VALIDATION_SHARE ? 'validation' : 'test';
  }

  private reportSummary(
    report: ConsolidationReport,
    applied: readonly string[],
  ): Omit<SubmitReviewResult, 'reviewIds'> {
    const skippedHumanScored: string[] = [];
    const pendingConsolidation: string[] = [];
    for (const skip of report.skipped) {
      if (skip.reason === 'human_scored') skippedHumanScored.push(skip.decisionId);
      if (skip.reason === 'no_response') pendingConsolidation.push(skip.decisionId);
    }
    return { appliedDecisionIds: [...applied], skippedHumanScored, pendingConsolidation };
  }
}
