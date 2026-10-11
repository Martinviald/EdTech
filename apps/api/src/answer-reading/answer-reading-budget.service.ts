import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { aiGradingJobs, answerReadings, withOrgContext } from '@soe/db';
import { orgConfigSchema, type ResolvedOrgAnswerReadingSettings } from '@soe/types';
import { AiObservabilityService } from '../ai-observability/ai-observability.service';
import { InjectDb, type Database } from '../database/database.types';
import {
  ANSWER_READING_OPTIONS,
  RUBRIC_GRADING_JOB_TYPE,
  type AnswerReadingOptions,
} from './answer-reading.constants';

const COST_SAMPLE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BudgetWorkload = 'reading' | 'rubric_grading';

interface SpendStats {
  readonly monthSpendUsd: number;
  readonly averageCostUsd: number | null;
}

interface SpendWindow {
  readonly monthStart: Date;
  readonly sampleStart: Date;
  readonly since: Date;
}

export interface BudgetCheckInput {
  readonly orgId: string;
  readonly orgConfig: unknown;
  readonly settings: ResolvedOrgAnswerReadingSettings;
  readonly plannedReadings: number;
  readonly workload?: BudgetWorkload;
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
    const { reading, rubricGrading } = await this.spendStats(input.orgId, now);
    const averageCostUsd =
      (input.workload === 'rubric_grading' ? rubricGrading : reading).averageCostUsd ??
      this.options.defaultEstimatedReadingCostUsd;
    const estimateUsd = input.plannedReadings * averageCostUsd;
    const monthReadingSpendUsd = reading.monthSpendUsd + rubricGrading.monthSpendUsd;
    if (readingBudgetUsd !== null && monthReadingSpendUsd + estimateUsd > readingBudgetUsd) {
      return true;
    }
    if (aiBudgetUsd === null) return false;
    const monthSpendUsd = await this.observability.monthSpendUsd(input.orgId, now);
    return monthSpendUsd + estimateUsd > aiBudgetUsd;
  }

  private async spendStats(
    orgId: string,
    now: Date,
  ): Promise<{ reading: SpendStats; rubricGrading: SpendStats }> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sampleStart = new Date(now.getTime() - COST_SAMPLE_DAYS * DAY_MS);
    const window: SpendWindow = {
      monthStart,
      sampleStart,
      since: monthStart < sampleStart ? monthStart : sampleStart,
    };
    return withOrgContext(this.db, orgId, async (tx) => ({
      reading: await this.readingStats(tx, orgId, window),
      rubricGrading: await this.rubricGradingStats(tx, orgId, window),
    }));
  }

  private async readingStats(
    tx: Database,
    orgId: string,
    window: SpendWindow,
  ): Promise<SpendStats> {
    const [row] = await tx
      .select({
        monthSpendUsd: sql<
          string | null
        >`coalesce(sum(${answerReadings.costUsd}) filter (where ${answerReadings.createdAt} >= ${window.monthStart.toISOString()}::timestamp), 0)`,
        averageCostUsd: sql<
          string | null
        >`avg(${answerReadings.costUsd}) filter (where ${answerReadings.status} = 'ok' and ${answerReadings.createdAt} >= ${window.sampleStart.toISOString()}::timestamp)`,
      })
      .from(answerReadings)
      .where(and(eq(answerReadings.orgId, orgId), gte(answerReadings.createdAt, window.since)));
    return this.toSpendStats(row);
  }

  private async rubricGradingStats(
    tx: Database,
    orgId: string,
    window: SpendWindow,
  ): Promise<SpendStats> {
    const [row] = await tx
      .select({
        monthSpendUsd: sql<
          string | null
        >`coalesce(sum(${aiGradingJobs.costUsd}) filter (where ${aiGradingJobs.createdAt} >= ${window.monthStart.toISOString()}::timestamp), 0)`,
        averageCostUsd: sql<
          string | null
        >`avg(${aiGradingJobs.costUsd}) filter (where ${aiGradingJobs.status} = 'completed' and ${aiGradingJobs.createdAt} >= ${window.sampleStart.toISOString()}::timestamp)`,
      })
      .from(aiGradingJobs)
      .where(
        and(
          eq(aiGradingJobs.orgId, orgId),
          eq(aiGradingJobs.type, RUBRIC_GRADING_JOB_TYPE),
          gte(aiGradingJobs.createdAt, window.since),
        ),
      );
    return this.toSpendStats(row);
  }

  private toSpendStats(
    row: { monthSpendUsd: string | null; averageCostUsd: string | null } | undefined,
  ): SpendStats {
    const average = row?.averageCostUsd == null ? null : Number(row.averageCostUsd);
    return {
      monthSpendUsd: Number(row?.monthSpendUsd ?? 0),
      averageCostUsd: average !== null && Number.isFinite(average) && average > 0 ? average : null,
    };
  }

  private aiBudgetOf(orgConfig: unknown): number | null {
    const parsed = orgConfigSchema.safeParse(orgConfig ?? {});
    if (!parsed.success) return 0;
    const budget = parsed.data.aiBudgetUsd;
    return typeof budget === 'number' && budget > 0 ? budget : null;
  }
}
