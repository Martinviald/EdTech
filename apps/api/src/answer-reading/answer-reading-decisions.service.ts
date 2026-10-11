import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  answerReadingDecisions,
  answerReviews,
  sheetScanMarks,
  sheetScans,
  withOrgContext,
  type AnswerReadingDecision,
  type AnswerReview,
} from '@soe/db';
import type { ConsensusResult } from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

export interface ReadingDecisionInput {
  readonly runId: string;
  readonly markId: string;
  readonly itemId: string;
  readonly assessmentId: string | null;
  readonly studentId: string | null;
  readonly routeId: string | null;
  readonly routeVersion: number | null;
  readonly result: ConsensusResult;
}

export interface SavedReadingDecision {
  readonly decisionId: string;
  readonly supersededId: string | null;
  readonly unchanged: boolean;
}

@Injectable()
export class AnswerReadingDecisionsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async save(orgId: string, input: ReadingDecisionInput): Promise<SavedReadingDecision> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const [current] = await tx
        .select()
        .from(answerReadingDecisions)
        .where(
          and(
            eq(answerReadingDecisions.orgId, orgId),
            eq(answerReadingDecisions.markId, input.markId),
            isNull(answerReadingDecisions.supersededById),
          ),
        )
        .limit(1);
      if (current && this.isSameDecision(current, input)) {
        return { decisionId: current.id, supersededId: null, unchanged: true };
      }
      const decisionId = randomUUID();
      const now = new Date();
      if (current) {
        await tx
          .update(answerReadingDecisions)
          .set({ supersededById: decisionId, updatedAt: now })
          .where(
            and(
              eq(answerReadingDecisions.orgId, orgId),
              eq(answerReadingDecisions.id, current.id),
              isNull(answerReadingDecisions.supersededById),
            ),
          );
      }
      const { result } = input;
      await tx.insert(answerReadingDecisions).values({
        id: decisionId,
        orgId,
        runId: input.runId,
        markId: input.markId,
        itemId: input.itemId,
        assessmentId: input.assessmentId,
        studentId: input.studentId,
        outcome: result.outcome,
        canonical: result.value?.canonical ?? null,
        value: result.value,
        scoringOutcome: result.scoringOutcome,
        reasons: result.reasons,
        reviewMode: result.reviewMode,
        routeId: input.routeId,
        routeVersion: input.routeVersion,
        policyId: result.policyId,
        policyVersion: result.policyVersion,
        usedReadingIds: [...result.usedReadingIds],
        createdAt: now,
        updatedAt: now,
      });
      return { decisionId, supersededId: current?.id ?? null, unchanged: false };
    });
  }

  async findCurrentByMarkIds(
    orgId: string,
    markIds: readonly string[],
  ): Promise<Map<string, AnswerReadingDecision>> {
    if (markIds.length === 0) return new Map();
    const rows = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select()
        .from(answerReadingDecisions)
        .where(
          and(
            eq(answerReadingDecisions.orgId, orgId),
            inArray(answerReadingDecisions.markId, [...markIds]),
            isNull(answerReadingDecisions.supersededById),
          ),
        ),
    );
    return new Map(rows.map((row) => [row.markId, row]));
  }

  async findCurrentByBatch(
    orgId: string,
    batchId: string,
  ): Promise<Map<string, AnswerReadingDecision>> {
    const rows = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({ decision: answerReadingDecisions })
        .from(answerReadingDecisions)
        .innerJoin(sheetScanMarks, eq(sheetScanMarks.id, answerReadingDecisions.markId))
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .where(
          and(
            eq(answerReadingDecisions.orgId, orgId),
            eq(sheetScans.batchId, batchId),
            ne(sheetScans.state, 'superseded'),
            isNull(answerReadingDecisions.supersededById),
          ),
        ),
    );
    return new Map(rows.map(({ decision }) => [decision.markId, decision]));
  }

  async activeReviewsByDecision(
    tx: Database,
    orgId: string,
    decisionIds: readonly string[],
  ): Promise<Map<string, AnswerReview>> {
    if (decisionIds.length === 0) return new Map();
    const rows = await tx
      .select()
      .from(answerReviews)
      .where(
        and(
          eq(answerReviews.orgId, orgId),
          inArray(answerReviews.decisionId, [...decisionIds]),
          isNull(answerReviews.supersededById),
          ne(answerReviews.action, 'undo'),
        ),
      )
      .orderBy(desc(answerReviews.createdAt));
    const byDecision = new Map<string, AnswerReview>();
    for (const row of rows) {
      if (!byDecision.has(row.decisionId)) byDecision.set(row.decisionId, row);
    }
    return byDecision;
  }

  private isSameDecision(current: AnswerReadingDecision, input: ReadingDecisionInput): boolean {
    const { result } = input;
    return (
      current.outcome === result.outcome &&
      current.canonical === (result.value?.canonical ?? null) &&
      current.scoringOutcome === result.scoringOutcome &&
      current.reviewMode === result.reviewMode &&
      current.policyId === result.policyId &&
      current.policyVersion === result.policyVersion &&
      current.routeId === input.routeId &&
      current.routeVersion === input.routeVersion &&
      this.sameMembers(current.reasons, result.reasons) &&
      this.sameMembers(current.usedReadingIds, result.usedReadingIds)
    );
  }

  private sameMembers(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const members = new Set(left);
    return right.every((value) => members.has(value));
  }
}
