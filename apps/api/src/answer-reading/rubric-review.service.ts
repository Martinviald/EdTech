import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  answerReadingDecisions,
  answerReviews,
  files,
  items,
  responses,
  sheetScanMarks,
  sheetScans,
  users,
  withOrgContext,
  type AnswerReadingDecision,
  type AnswerReview,
  type NewAnswerReview,
  type Response,
} from '@soe/db';
import {
  rubricScoredContentSchema,
  rubricScoredStrategy,
  type AcceptRubricProposalsDto,
  type ItemContent,
  type ItemType,
  type RubricAiProposal,
  type RubricApprovalDto,
  type RubricApprovalResult,
  type RubricApprovalState,
  type RubricLevelOption,
  type RubricQueueEntry,
  type RubricQueuePage,
  type RubricQueueQuery,
  type RubricReviewDetail,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';
import { FilesService } from '../files/files.service';
import { AnswerReadingDecisionsService } from './answer-reading-decisions.service';
import {
  RubricGradingService,
  type RubricLevelApproval,
  type RubricLevelRequest,
} from './rubric-grading.service';

interface RubricTarget {
  readonly decision: AnswerReadingDecision;
  readonly response: Pick<Response, 'id' | 'value' | 'aiScore' | 'humanScore'> | null;
}

interface MarkInfo {
  readonly printedNumber: string;
  readonly cropFileId: string | null;
}

interface LoadedRubricItem {
  readonly id: string;
  readonly stem: string;
  readonly maxScore: number;
  readonly levels: RubricLevelOption[];
}

type ApprovalSkip = RubricApprovalResult['skipped'][number];

const RUBRIC_REASON = 'rubric_item';
const UNKNOWN_PRINTED_NUMBER = '?';
const RUBRIC_REVIEW_ACTIONS: ReadonlySet<AnswerReview['action']> = new Set([
  'mark_correct',
  'mark_incorrect',
]);
const NOT_FOUND_MESSAGE = 'No encontramos esa respuesta de desarrollo en tu organización';

@Injectable()
export class RubricReviewService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly decisions: AnswerReadingDecisionsService,
    private readonly rubricGrading: RubricGradingService,
    private readonly filesService: FilesService,
  ) {}

  async queue(orgId: string, query: RubricQueueQuery): Promise<RubricQueuePage> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const scoped = await this.scopeDecisions(tx, orgId, query);
      const candidates = scoped.filter(
        (decision) =>
          this.isRubricDecision(decision) &&
          decision.outcome === 'needs_review' &&
          (query.itemId === undefined || decision.itemId === query.itemId),
      );
      const reviews = await this.decisions.activeReviewsByDecision(
        tx,
        orgId,
        candidates.map((decision) => decision.id),
      );
      const pending = candidates.filter((decision) => !reviews.has(decision.id));
      const marks = await this.marksById(tx, orgId, pending);
      const sorted = this.sortByPrintedNumber(pending, marks);
      const offset = (query.page - 1) * query.pageSize;
      const page = sorted.slice(offset, offset + query.pageSize);
      const responsesById = await this.responsesById(tx, page);
      const urls = await this.cropUrls(tx, orgId, page, marks);
      return {
        data: page.map((decision) =>
          this.toQueueEntry(decision, marks, urls, responsesById.get(decision.responseId ?? '')),
        ),
        total: sorted.length,
        page: query.page,
        limit: query.pageSize,
      };
    });
  }

  async detail(orgId: string, decisionId: string): Promise<RubricReviewDetail> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [decision] = await tx
        .select()
        .from(answerReadingDecisions)
        .where(
          and(eq(answerReadingDecisions.orgId, orgId), eq(answerReadingDecisions.id, decisionId)),
        )
        .limit(1);
      if (!decision || !this.isRubricDecision(decision)) {
        throw new NotFoundException(NOT_FOUND_MESSAGE);
      }
      const item = (await this.loadItems(tx, [decision.itemId])).get(decision.itemId);
      const marks = await this.marksById(tx, orgId, [decision]);
      const urls = await this.cropUrls(tx, orgId, [decision], marks);
      const response = (await this.responsesById(tx, [decision])).get(decision.responseId ?? '');
      const activeReview = (
        await this.decisions.activeReviewsByDecision(tx, orgId, [decision.id])
      ).get(decision.id);
      const mark = marks.get(decision.markId);
      return {
        decisionId: decision.id,
        itemId: decision.itemId,
        printedNumber: mark?.printedNumber ?? UNKNOWN_PRINTED_NUMBER,
        formatKind: decision.value?.formatKind ?? null,
        stem: item?.stem ?? null,
        transcription: this.transcriptionOf(decision),
        cropUrl: this.cropUrlOf(mark, urls),
        maxScore: item?.maxScore ?? 0,
        levels: item?.levels ?? [],
        proposal: this.proposalOf(decision, response),
        approval: await this.approvalOf(tx, activeReview),
        pending:
          decision.supersededById === null &&
          decision.outcome === 'needs_review' &&
          activeReview === undefined,
        awaitingConfirmation: decision.responseId === null,
      };
    });
  }

  async approve(
    orgId: string,
    reviewerId: string,
    dto: RubricApprovalDto,
  ): Promise<RubricApprovalResult> {
    const reason = dto.reason?.trim() ? dto.reason.trim() : undefined;
    return this.applyApprovals(orgId, reviewerId, [dto.decisionId], (target) => ({
      decisionId: target.decision.id,
      levelCode: dto.levelCode,
      ...(reason === undefined ? {} : { reason }),
    }));
  }

  async acceptProposals(
    orgId: string,
    reviewerId: string,
    dto: AcceptRubricProposalsDto,
  ): Promise<RubricApprovalResult> {
    return this.applyApprovals(orgId, reviewerId, dto.acceptAiProposals, (target) => {
      const proposal = this.proposalOf(target.decision, target.response ?? undefined);
      return proposal === null
        ? null
        : { decisionId: target.decision.id, levelCode: proposal.levelCode };
    });
  }

  private async applyApprovals(
    orgId: string,
    reviewerId: string,
    requestedIds: readonly string[],
    requestFor: (target: RubricTarget) => RubricLevelRequest | null,
  ): Promise<RubricApprovalResult> {
    const decisionIds = [...new Set(requestedIds)];
    const targets = await withOrgContext(this.db, orgId, (tx) =>
      this.loadTargets(tx, orgId, decisionIds),
    );
    const skipped: ApprovalSkip[] = [];
    const requests: RubricLevelRequest[] = [];
    for (const target of targets) {
      if (this.hasForeignHumanScore(target)) {
        skipped.push({ decisionId: target.decision.id, reason: 'human_scored' });
        continue;
      }
      const request = requestFor(target);
      if (request === null) skipped.push({ decisionId: target.decision.id, reason: 'no_proposal' });
      else requests.push(request);
    }
    if (requests.length === 0) return { reviewIds: [], approvedDecisionIds: [], skipped };
    const { report, approved } = await this.rubricGrading.approveRubricLevels(
      orgId,
      requests,
      reviewerId,
    );
    const scored = new Set(report.scored);
    const applied: RubricLevelApproval[] = [];
    for (const approval of approved) {
      if (scored.has(approval.decisionId)) applied.push(approval);
      else skipped.push({ decisionId: approval.decisionId, reason: 'not_applied' });
    }
    const reviewIds = await this.recordReviews(orgId, reviewerId, applied, targets);
    return {
      reviewIds,
      approvedDecisionIds: applied.map((approval) => approval.decisionId),
      skipped,
    };
  }

  private async loadTargets(
    tx: Database,
    orgId: string,
    decisionIds: readonly string[],
  ): Promise<RubricTarget[]> {
    const rows = await tx
      .select()
      .from(answerReadingDecisions)
      .where(
        and(
          eq(answerReadingDecisions.orgId, orgId),
          inArray(answerReadingDecisions.id, [...decisionIds]),
        ),
      );
    if (rows.length !== decisionIds.length) throw new NotFoundException(NOT_FOUND_MESSAGE);
    if (rows.some((decision) => !this.isRubricDecision(decision))) {
      throw new BadRequestException('Una o más respuestas no se califican con rúbrica');
    }
    if (rows.some((decision) => decision.supersededById !== null)) {
      throw new ConflictException(
        'Una o más respuestas se volvieron a leer mientras revisabas; recarga la revisión',
      );
    }
    if (rows.some((decision) => decision.responseId === null)) {
      throw new ConflictException(
        'Confirma el lote antes de calificar con la rúbrica: la respuesta todavía no está asociada a un alumno',
      );
    }
    const responsesById = await this.responsesById(tx, rows);
    const byId = new Map(rows.map((decision) => [decision.id, decision]));
    return decisionIds.map((decisionId) => {
      const decision = byId.get(decisionId) as AnswerReadingDecision;
      return { decision, response: responsesById.get(decision.responseId ?? '') ?? null };
    });
  }

  private hasForeignHumanScore(target: RubricTarget): boolean {
    const response = target.response;
    if (response === null || response.humanScore === null) return false;
    return this.writtenByDecisionId(response.value) !== target.decision.id;
  }

  private writtenByDecisionId(value: unknown): string | null {
    if (value === null || typeof value !== 'object') return null;
    const reading = (value as { reading?: unknown }).reading;
    if (reading === null || typeof reading !== 'object') return null;
    const decisionId = (reading as { decisionId?: unknown }).decisionId;
    return typeof decisionId === 'string' ? decisionId : null;
  }

  private async recordReviews(
    orgId: string,
    reviewerId: string,
    applied: readonly RubricLevelApproval[],
    targets: readonly RubricTarget[],
  ): Promise<string[]> {
    if (applied.length === 0) return [];
    const decisionById = new Map(targets.map((target) => [target.decision.id, target.decision]));
    return withOrgContext(this.db, orgId, async (tx) => {
      const groupOperationId = randomUUID();
      const now = new Date();
      const rows: NewAnswerReview[] = applied.map((approval) => {
        const decision = decisionById.get(approval.decisionId);
        return {
          id: randomUUID(),
          orgId,
          decisionId: approval.decisionId,
          reviewerId,
          mode: 'grading',
          action: approval.isCorrect ? 'mark_correct' : 'mark_incorrect',
          editedLiteral: approval.levelCode,
          resultingCanonical: decision?.canonical ?? null,
          resultingValue: decision?.value ?? null,
          reason: approval.reason ?? null,
          groupOperationId,
          groupSize: applied.length,
          createdAt: now,
        };
      });
      const open = await tx
        .select({ id: answerReviews.id, decisionId: answerReviews.decisionId })
        .from(answerReviews)
        .where(
          and(
            eq(answerReviews.orgId, orgId),
            inArray(
              answerReviews.decisionId,
              rows.map((row) => row.decisionId),
            ),
            isNull(answerReviews.supersededById),
          ),
        );
      await tx.insert(answerReviews).values(rows);
      const newIdByDecision = new Map(rows.map((row) => [row.decisionId, row.id as string]));
      await this.supersedeReviews(
        tx,
        orgId,
        open.map((review) => ({
          id: review.id,
          superseded_by_id: newIdByDecision.get(review.decisionId),
        })),
      );
      return rows.map((row) => row.id as string);
    });
  }

  private async supersedeReviews(
    tx: Database,
    orgId: string,
    pairs: ReadonlyArray<{ id: string; superseded_by_id: string | undefined }>,
  ): Promise<void> {
    const payload = pairs.filter((pair) => pair.superseded_by_id !== undefined);
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

  private isRubricDecision(decision: AnswerReadingDecision): boolean {
    return decision.reasons.includes(RUBRIC_REASON);
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
    const scans = await tx
      .select({ id: sheetScans.id })
      .from(sheetScans)
      .where(
        and(
          eq(sheetScans.orgId, orgId),
          eq(sheetScans.batchId, scope.batchId),
          ne(sheetScans.state, 'superseded'),
        ),
      );
    if (scans.length === 0) return [];
    const marks = await tx
      .select({ id: sheetScanMarks.id })
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

  private async marksById(
    tx: Database,
    orgId: string,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<Map<string, MarkInfo>> {
    if (decisions.length === 0) return new Map();
    const rows = await tx
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
    return new Map(
      rows.map((row) => [
        row.id,
        { printedNumber: row.printedNumber ?? UNKNOWN_PRINTED_NUMBER, cropFileId: row.cropFileId },
      ]),
    );
  }

  private sortByPrintedNumber(
    decisions: readonly AnswerReadingDecision[],
    marks: ReadonlyMap<string, MarkInfo>,
  ): AnswerReadingDecision[] {
    const ranked = decisions.map((decision) => ({
      decision,
      printedNumber: marks.get(decision.markId)?.printedNumber ?? UNKNOWN_PRINTED_NUMBER,
    }));
    ranked.sort(
      (left, right) =>
        left.printedNumber.localeCompare(right.printedNumber, 'es', { numeric: true }) ||
        left.decision.createdAt.getTime() - right.decision.createdAt.getTime() ||
        left.decision.id.localeCompare(right.decision.id),
    );
    return ranked.map((entry) => entry.decision);
  }

  private async responsesById(
    tx: Database,
    decisions: readonly AnswerReadingDecision[],
  ): Promise<Map<string, Pick<Response, 'id' | 'value' | 'aiScore' | 'humanScore'>>> {
    const responseIds = new Set<string>();
    for (const decision of decisions) {
      if (decision.responseId !== null) responseIds.add(decision.responseId);
    }
    if (responseIds.size === 0) return new Map();
    const rows = await tx
      .select({
        id: responses.id,
        value: responses.value,
        aiScore: responses.aiScore,
        humanScore: responses.humanScore,
      })
      .from(responses)
      .where(inArray(responses.id, [...responseIds]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async cropUrls(
    tx: Database,
    orgId: string,
    decisions: readonly AnswerReadingDecision[],
    marks: ReadonlyMap<string, MarkInfo>,
  ): Promise<Map<string, string | null>> {
    const fileIds = new Set<string>();
    for (const decision of decisions) {
      const cropFileId = marks.get(decision.markId)?.cropFileId;
      if (cropFileId) fileIds.add(cropFileId);
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

  private cropUrlOf(
    mark: MarkInfo | undefined,
    urls: ReadonlyMap<string, string | null>,
  ): string | null {
    if (!mark || mark.cropFileId === null) return null;
    return urls.get(mark.cropFileId) ?? null;
  }

  private async loadItems(
    tx: Database,
    itemIds: readonly string[],
  ): Promise<Map<string, LoadedRubricItem>> {
    const rows = await tx
      .select({
        id: items.id,
        type: items.type,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(inArray(items.id, [...new Set(itemIds)]));
    const byId = new Map<string, LoadedRubricItem>();
    for (const row of rows) {
      const content = rubricScoredContentSchema.safeParse(row.content ?? {});
      if (!content.success) continue;
      const scoringConfig = (row.scoringConfig ?? {}) as { points?: unknown };
      const maxScore = typeof scoringConfig.points === 'number' ? scoringConfig.points : 1;
      byId.set(row.id, {
        id: row.id,
        stem: content.data.prompt,
        maxScore,
        levels: content.data.levels.map((level) => ({
          code: level.code,
          label: level.label ?? null,
          descriptor: level.descriptor ?? null,
          creditFraction: level.creditFraction,
          score: this.levelScore(row, maxScore, level.code),
        })),
      });
    }
    return byId;
  }

  private levelScore(
    row: { id: string; type: string; content: unknown },
    maxScore: number,
    levelCode: string,
  ): number {
    const scored = rubricScoredStrategy.score({
      item: {
        id: row.id,
        type: row.type as ItemType,
        content: row.content as ItemContent,
        maxScore,
        scoringConfig: { points: maxScore },
      },
      rawAnswer: levelCode,
    });
    return scored.rawScore ?? 0;
  }

  private transcriptionOf(decision: AnswerReadingDecision): string | null {
    const value = decision.value?.value;
    return value?.type === 'text' ? value.text : null;
  }

  private proposalOf(
    decision: AnswerReadingDecision,
    response: Pick<Response, 'aiScore'> | undefined,
  ): RubricAiProposal | null {
    const aiScore = response?.aiScore;
    if (!aiScore || aiScore.decisionId !== decision.id || !aiScore.levelCode) return null;
    return {
      levelCode: aiScore.levelCode,
      score: typeof aiScore.score === 'number' ? aiScore.score : null,
      confidence: typeof aiScore.confidence === 'number' ? aiScore.confidence : null,
      rationale: aiScore.rationale ?? aiScore.justification ?? null,
      evidenceQuotes: aiScore.evidenceQuotes ?? [],
      model: aiScore.model ?? null,
      promptVersion: aiScore.promptVersion ?? null,
    };
  }

  private async approvalOf(
    tx: Database,
    review: AnswerReview | undefined,
  ): Promise<RubricApprovalState | null> {
    if (!review || !RUBRIC_REVIEW_ACTIONS.has(review.action) || !review.editedLiteral) {
      return null;
    }
    const [reviewer] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, review.reviewerId))
      .limit(1);
    return {
      reviewId: review.id,
      levelCode: review.editedLiteral,
      reviewerName: reviewer?.name ?? null,
      approvedAt: review.createdAt.toISOString(),
    };
  }

  private toQueueEntry(
    decision: AnswerReadingDecision,
    marks: ReadonlyMap<string, MarkInfo>,
    urls: ReadonlyMap<string, string | null>,
    response: Pick<Response, 'aiScore'> | undefined,
  ): RubricQueueEntry {
    const mark = marks.get(decision.markId);
    const proposal = this.proposalOf(decision, response);
    return {
      decisionId: decision.id,
      itemId: decision.itemId,
      printedNumber: mark?.printedNumber ?? UNKNOWN_PRINTED_NUMBER,
      transcription: this.transcriptionOf(decision),
      cropUrl: this.cropUrlOf(mark, urls),
      proposal:
        proposal === null
          ? null
          : { levelCode: proposal.levelCode, confidence: proposal.confidence },
      awaitingConfirmation: decision.responseId === null,
    };
  }
}
