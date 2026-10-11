import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { fakeOutput, normalizeTranscription } from '@soe/answer-reading';
import {
  answerReadingDecisions,
  answerReadings,
  answerReviews,
  files,
  items,
  organizations,
  responses,
  sheetScanMarks,
  type AnswerReadingDecision,
  type AnswerReadingRow,
  type AnswerReview,
  type Response,
} from '@soe/db';
import type { DatasetConsent, NormalizedAnswer, ResponseFormat } from '@soe/types';
import type { AssessmentResultsService } from '../../assessment-results/assessment-results.service';
import type { FilesService } from '../../files/files.service';
import { AnswerReadingConsolidationService } from '../answer-reading-consolidation.service';
import { AnswerReadingDecisionsService } from '../answer-reading-decisions.service';
import { AnswerReadingReviewQueueService } from '../answer-reading-review-queue.service';
import { AnswerReadingReviewsService } from '../answer-reading-reviews.service';
import { InMemoryDatabase } from './in-memory-database';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG_ID = '11111111-1111-4111-8111-111111111112';
export const ASSESSMENT_ID = '44444444-4444-4444-8444-444444444444';
export const STUDENT_ID = '55555555-5555-4555-8555-555555555555';
export const REVIEWER_ID = '66666666-6666-4666-8666-666666666666';
export const RUN_ID = '77777777-7777-4777-8777-777777777777';
export const NUMBER_ITEM = 'aaaaaaaa-0000-4000-8000-000000000001';
export const UNIT_ITEM = 'aaaaaaaa-0000-4000-8000-000000000002';

export const INTEGER: ResponseFormat = { kind: 'integer', maxChars: 3, allowNegative: false };

type Row = Record<string, unknown>;

interface ResponseUpdate {
  id: string;
  value: Record<string, unknown>;
  is_correct: boolean | null;
  raw_score: string | null;
  scored_by: Response['scoredBy'];
  scored: boolean;
  ai_score: Response['aiScore'];
  human_score: Response['humanScore'];
  respect_human: boolean;
  clear_human: boolean;
}

export function answer(literal: string, format: ResponseFormat = INTEGER): NormalizedAnswer {
  return normalizeTranscription(fakeOutput(literal), format);
}

export function setupReviewWorld(options: { consent?: DatasetConsent } = {}) {
  const memory = new InMemoryDatabase();
  memory.seed(organizations, [
    {
      id: ORG_ID,
      type: 'school',
      name: 'Colegio',
      config:
        options.consent === undefined ? {} : { answerReading: { datasetConsent: options.consent } },
    },
  ]);
  memory.seed(items, [
    {
      id: NUMBER_ITEM,
      type: 'short_answer',
      content: { prompt: '¿Cuántos lados?', acceptedAnswers: ['7'] },
      scoringConfig: { points: 1 },
    },
    {
      id: UNIT_ITEM,
      type: 'short_answer',
      content: { prompt: '¿Cuántos metros?', acceptedAnswers: ['12'], unit: 'm' },
      scoringConfig: { points: 2 },
    },
  ]);

  const dialect = new PgDialect();
  const db = memory.asDatabase();
  (db as unknown as { execute: (query: SQL) => Promise<unknown[]> }).execute = async (query) => {
    const rendered = dialect.sqlToQuery(query);
    const payload = rendered.params[0];
    if (rendered.sql.includes('UPDATE responses')) {
      return applyResponseUpdates(memory, JSON.parse(String(payload)));
    }
    if (rendered.sql.includes('UPDATE answer_reading_decisions')) {
      applyDecisionLinks(memory, JSON.parse(String(payload)));
    }
    if (rendered.sql.includes('UPDATE answer_reviews')) {
      applyReviewSupersessions(memory, JSON.parse(String(payload)));
    }
    return [];
  };

  const decisions = new AnswerReadingDecisionsService(db);
  const recalculate = jest.fn(async (_orgId: string, assessmentIds: readonly string[]) => [
    ...new Set(assessmentIds),
  ]);
  const results = {
    recalculateAnswerSheetResults: recalculate,
  } as unknown as AssessmentResultsService;
  const consolidation = new AnswerReadingConsolidationService(db, decisions, results);
  const filesService = {
    buildDownloadUrl: (row: { id: string }) => `https://recortes.test/${row.id}.jpg`,
  } as unknown as FilesService;
  const queue = new AnswerReadingReviewQueueService(db, decisions, filesService);
  const reviews = new AnswerReadingReviewsService(db, decisions, consolidation);

  let sequence = 0;
  function seedDecision(overrides: Partial<AnswerReadingDecision> & { literal?: string } = {}) {
    sequence += 1;
    const suffix = String(sequence).padStart(12, '0');
    const markId = overrides.markId ?? `bbbbbbbb-0000-4000-8000-${suffix}`;
    const cropFileId = `ffffffff-0000-4000-8000-${suffix}`;
    const { literal, ...decisionOverrides } = overrides;
    const value =
      decisionOverrides.value !== undefined
        ? decisionOverrides.value
        : literal !== undefined
          ? answer(literal)
          : null;
    memory.seed(files, [
      { id: cropFileId, orgId: decisionOverrides.orgId ?? ORG_ID, storageKey: `k/${suffix}` },
    ]);
    memory.seed(sheetScanMarks, [
      {
        id: markId,
        orgId: decisionOverrides.orgId ?? ORG_ID,
        printedNumber: '7',
        fieldId: 'q7',
        cropFileId,
      },
    ]);
    const readingIds: string[] = [];
    for (const [index, reader] of ['haiku', 'flash'].entries()) {
      const readingId = `cccccccc-000${index}-4000-8000-${suffix}`;
      readingIds.push(readingId);
      const readLiteral = literal ?? '7';
      memory.seed(answerReadings, [
        {
          id: readingId,
          orgId: decisionOverrides.orgId ?? ORG_ID,
          runId: RUN_ID,
          markId,
          itemId: decisionOverrides.itemId ?? NUMBER_ITEM,
          responseFormat: INTEGER,
          readerKey: reader,
          provider: reader === 'haiku' ? 'anthropic' : 'google',
          model: reader,
          mode: 'primary',
          status: 'ok',
          readingState: 'answered',
          literal: readLiteral,
          confidence: '0.700',
          normalized: answer(readLiteral),
          output: {
            ...fakeOutput(readLiteral),
            alternativeReadings: [{ literal: '1', parts: null, plausibility: 0.3 }],
          },
        },
      ]);
    }
    memory.seed(answerReadingDecisions, [
      {
        orgId: ORG_ID,
        runId: RUN_ID,
        markId,
        itemId: NUMBER_ITEM,
        assessmentId: ASSESSMENT_ID,
        studentId: STUDENT_ID,
        outcome: 'needs_review',
        canonical: value?.canonical ?? null,
        value,
        reasons: ['readers_disagree'],
        reviewMode: 'reading',
        policyId: 'short-answer-default',
        policyVersion: 1,
        usedReadingIds: readingIds,
        ...decisionOverrides,
      },
    ]);
    return last<AnswerReadingDecision>(memory.rows(answerReadingDecisions));
  }

  function seedResponse(overrides: Partial<Response> = {}) {
    memory.seed(responses, [
      {
        assessmentId: ASSESSMENT_ID,
        studentId: STUDENT_ID,
        itemId: NUMBER_ITEM,
        value: { answer: null, pendingReading: true },
        isCorrect: null,
        rawScore: null,
        maxScore: '1.00',
        finalScore: null,
        scoredBy: 'human',
        aiScore: null,
        humanScore: null,
        ...overrides,
      },
    ]);
    return last<Response>(memory.rows(responses));
  }

  return {
    memory,
    db,
    decisions,
    queue,
    reviews,
    consolidation,
    recalculate,
    seedDecision,
    seedResponse,
    reviewRows: () => memory.rows<AnswerReview>(answerReviews),
    readings: () => memory.rows<AnswerReadingRow>(answerReadings),
  };
}

function last<T>(rows: T[]): T {
  const row = rows[rows.length - 1];
  if (row === undefined) throw new Error('No hay filas sembradas');
  return row;
}

function applyResponseUpdates(memory: InMemoryDatabase, updates: ResponseUpdate[]) {
  const byId = new Map(memory.rows<Response>(responses).map((row) => [row.id, row]));
  const applied: Array<{ id: string }> = [];
  for (const update of updates) {
    const row = byId.get(update.id);
    if (!row) continue;
    if (update.respect_human && row.humanScore !== null) continue;
    Object.assign(row, {
      value: update.value,
      isCorrect: update.is_correct,
      rawScore: update.raw_score,
      finalScore: update.raw_score,
      scoredBy: update.scored_by,
      scoredAt: update.scored ? new Date() : null,
      aiScore: update.ai_score ?? row.aiScore,
      humanScore: update.clear_human ? null : (update.human_score ?? row.humanScore),
    });
    applied.push({ id: row.id });
  }
  return applied;
}

function applyDecisionLinks(
  memory: InMemoryDatabase,
  links: Array<{ id: string; response_id: string; resolved: boolean }>,
) {
  const byId = new Map(
    memory.rows<AnswerReadingDecision>(answerReadingDecisions).map((row) => [row.id, row]),
  );
  for (const link of links) {
    const row = byId.get(link.id);
    if (!row) continue;
    row.responseId = link.response_id;
    if (link.resolved) row.resolvedAt = new Date();
  }
}

function applyReviewSupersessions(
  memory: InMemoryDatabase,
  pairs: Array<{ id: string; superseded_by_id: string }>,
) {
  const byId = new Map(memory.rows<Row>(answerReviews).map((row) => [row.id, row]));
  for (const pair of pairs) {
    const row = byId.get(pair.id);
    if (row && row.supersededById === null) row.supersededById = pair.superseded_by_id;
  }
}
