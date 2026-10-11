import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { answerReadings, withOrgContext } from '@soe/db';
import { orgConfigSchema, type ResolvedOrgAnswerReadingSettings } from '@soe/types';
import { AiObservabilityService } from '../ai-observability/ai-observability.service';
import { InjectDb, type Database } from '../database/database.types';
import { ANSWER_READING_OPTIONS, type AnswerReadingOptions } from './answer-reading.constants';

const COST_SAMPLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BudgetCheckInput {
  readonly orgId: string;
  readonly orgConfig: unknown;
  readonly settings: ResolvedOrgAnswerReadingSettings;
  readonly plannedReadings: number;
  readonly now?: Date;
}

@Injectable()
export class AnswerReadingBudgetService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly observability: AiObservabilityService,
    @Inject(ANSWER_READING_OPTIONS) private readonly options: AnswerReadingOptions,
  ) {}

  async isExceeded(input: BudgetCheckInput): Promise<boolean> {
    const aiBudgetUsd = this.aiBudgetOf(input.orgConfig);
    const readingBudgetUsd = input.settings.monthlyBudgetUsd ?? null;
    if (input.plannedReadings === 0 || (aiBudgetUsd === null && readingBudgetUsd === null)) {
      return false;
    }
    const now = input.now ?? new Date();
    const stats = await this.readingStats(input.orgId, now);
    const estimateUsd =
      input.plannedReadings * (stats.averageCostUsd ?? this.options.defaultEstimatedReadingCostUsd);
    if (readingBudgetUsd !== null && stats.monthSpendUsd + estimateUsd > readingBudgetUsd) {
      return true;
    }
    if (aiBudgetUsd === null) return false;
    const monthSpendUsd = await this.observability.monthSpendUsd(input.orgId, now);
    return monthSpendUsd + estimateUsd > aiBudgetUsd;
  }

  private async readingStats(
    orgId: string,
    now: Date,
  ): Promise<{ monthSpendUsd: number; averageCostUsd: number | null }> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sampleStart = new Date(now.getTime() - COST_SAMPLE_DAYS * DAY_MS);
    const since = monthStart < sampleStart ? monthStart : sampleStart;
    const [row] = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({
          monthSpendUsd: sql<
            string | null
          >`coalesce(sum(${answerReadings.costUsd}) filter (where ${answerReadings.createdAt} >= ${monthStart.toISOString()}::timestamp), 0)`,
          averageCostUsd: sql<
            string | null
          >`avg(${answerReadings.costUsd}) filter (where ${answerReadings.status} = 'ok' and ${answerReadings.createdAt} >= ${sampleStart.toISOString()}::timestamp)`,
        })
        .from(answerReadings)
        .where(and(eq(answerReadings.orgId, orgId), gte(answerReadings.createdAt, since))),
    );
    const average = row?.averageCostUsd == null ? null : Number(row.averageCostUsd);
    return {
      monthSpendUsd: Number(row?.monthSpendUsd ?? 0),
      averageCostUsd: average !== null && Number.isFinite(average) && average > 0 ? average : null,
    };
  }

  private aiBudgetOf(orgConfig: unknown): number | null {
    const parsed = orgConfigSchema.safeParse(orgConfig ?? {});
    if (!parsed.success) return null;
    const budget = parsed.data.aiBudgetUsd;
    return typeof budget === 'number' && budget > 0 ? budget : null;
  }
}
