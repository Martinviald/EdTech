import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  answerReadingDecisions,
  responses,
  type AnswerReadingDecision,
  type Database,
  type Response,
} from '@soe/db';
import type { InMemoryDatabase } from './in-memory-database';

type ResponseUpdate = {
  id: string;
  value: Record<string, unknown>;
  is_correct: boolean | null;
  raw_score: string | null;
  scored_by: Response['scoredBy'];
  scored: boolean;
  ai_score: Response['aiScore'];
  human_score: Response['humanScore'];
  respect_human: boolean;
};

type DecisionLinkUpdate = { id: string; response_id: string; resolved: boolean };

type ResponseClaim = { mark_id: string; student_id: string; item_id: string };

function applyResponseClaims(
  memory: InMemoryDatabase,
  claims: ResponseClaim[],
  assessmentId: string,
) {
  for (const claim of claims) {
    for (const row of memory.rows<Response>(responses)) {
      if (
        row.assessmentId !== assessmentId ||
        row.studentId !== claim.student_id ||
        row.itemId !== claim.item_id ||
        row.humanScore !== null
      ) {
        continue;
      }
      const reading = row.value.reading;
      const previous = reading !== null && typeof reading === 'object' ? reading : {};
      row.value = { ...row.value, reading: { ...previous, markId: claim.mark_id } };
    }
  }
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
      humanScore: update.human_score ?? row.humanScore,
    });
    applied.push({ id: row.id });
  }
  return applied;
}

function applyDecisionLinks(memory: InMemoryDatabase, links: DecisionLinkUpdate[]) {
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

export function consolidationDatabase(memory: InMemoryDatabase): {
  db: Database;
  statements: string[];
} {
  const dialect = new PgDialect();
  const statements: string[] = [];
  const db = memory.asDatabase();
  (db as unknown as { execute: (query: SQL) => Promise<unknown[]> }).execute = async (query) => {
    const rendered = dialect.sqlToQuery(query);
    statements.push(rendered.sql);
    if (rendered.sql.includes("jsonb_build_object('markId'")) {
      applyResponseClaims(
        memory,
        JSON.parse(String(rendered.params[0])),
        String(rendered.params[1]),
      );
      return [];
    }
    if (rendered.sql.includes('UPDATE responses')) {
      return applyResponseUpdates(memory, JSON.parse(String(rendered.params[0])));
    }
    if (rendered.sql.includes('UPDATE answer_reading_decisions')) {
      applyDecisionLinks(memory, JSON.parse(String(rendered.params[0])));
    }
    return [];
  };
  return { db, statements };
}
