import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { decisionCalls, withOrgContext } from '@soe/db';
import type { DecisionAnswer, DecisionState } from '@soe/decisions';
import type {
  DecisionAnswerRecord,
  DecisionEngineId,
  DecisionFeature,
  DecisionMode,
} from '@soe/types';
import { reportServerError } from '../common/observability/report-error';
import { InjectDb, type Database } from '../database/database.types';
import { estimateLlmCostUsd } from '../llm/llm.pricing';

const DECISION_COST_DECIMALS = 9;

export interface DecisionCallEntry {
  orgId: string;
  feature: DecisionFeature;
  engine: DecisionEngineId;
  mode: Extract<DecisionMode, 'shadow' | 'live'>;
  state: DecisionState;
  model: string | null;
  answers: Readonly<Record<string, DecisionAnswer>> | null;
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number | null;
  baseline?: Record<string, unknown> | null;
  correlationId?: string | null;
}

@Injectable()
export class DecisionCallsRecorder {
  constructor(@InjectDb() private readonly db: Database) {}

  async record(entry: DecisionCallEntry): Promise<void> {
    try {
      await withOrgContext(this.db, entry.orgId, (tx) =>
        tx.insert(decisionCalls).values({
          orgId: entry.orgId,
          feature: entry.feature,
          engine: entry.engine,
          model: entry.model,
          mode: entry.mode,
          status: entry.errorCode ? 'error' : 'ok',
          errorCode: entry.errorCode,
          answers: entry.answers ? this.toAnswerRecords(entry.answers) : null,
          baseline: entry.baseline ?? null,
          stateHash: this.hashState(entry.state),
          correlationId: entry.correlationId ?? null,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          latencyMs: entry.latencyMs === null ? null : Math.round(entry.latencyMs),
          costUsd: estimateLlmCostUsd(
            entry.model,
            { inputTokens: entry.inputTokens, outputTokens: entry.outputTokens },
            DECISION_COST_DECIMALS,
          ),
        }),
      );
    } catch (error) {
      reportServerError(error, {
        scope: 'decision_calls',
        orgId: entry.orgId,
        feature: entry.feature,
      });
    }
  }

  private hashState(state: DecisionState): string {
    const serialized = typeof state === 'string' ? state : JSON.stringify(state);
    return createHash('sha256').update(serialized).digest('hex');
  }

  private toAnswerRecords(
    answers: Readonly<Record<string, DecisionAnswer>>,
  ): Record<string, DecisionAnswerRecord> {
    const records: Record<string, DecisionAnswerRecord> = {};
    for (const [questionId, answer] of Object.entries(answers)) {
      records[questionId] = this.toAnswerRecord(answer);
    }
    return records;
  }

  private toAnswerRecord(answer: DecisionAnswer): DecisionAnswerRecord {
    switch (answer.type) {
      case 'noul':
        return { type: 'noul', probability: answer.probability };
      case 'choice':
        return {
          type: 'choice',
          choice: answer.choice,
          probabilities: { ...answer.probabilities },
          confidence: answer.confidence,
        };
      case 'score':
        return {
          type: 'score',
          score: answer.score,
          level: answer.level,
          probabilities: [...answer.probabilities],
          confidence: answer.confidence,
        };
    }
  }
}
