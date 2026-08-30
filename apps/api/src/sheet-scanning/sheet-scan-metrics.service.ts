import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  markStateEnum,
  sheetScanBatchStatusEnum,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  withOrgContext,
} from '@soe/db';
import { PAGE_REJECT_REASONS } from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

const REVIEW_MARK_STATES = ['ambiguous', 'multiple'] as const;
const FIRM_MARK_STATES = ['marked', 'blank'] as const;
const UNKNOWN_REJECT_REASON = 'unknown';

type CountByKey = { key: string | null; count: number };

export type SheetScanMetricsResponse = {
  batchesByStatus: Record<string, number>;
  rejectedPagesByReason: Record<string, number>;
  marksByState: Record<string, number>;
  reviewRatePercent: number;
  firmReadingOverrides: number;
};

@Injectable()
export class SheetScanMetricsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getMetrics(orgId: string): Promise<SheetScanMetricsResponse> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const batchRows = await tx
        .select({ key: sheetScanBatches.status, count: sql<number>`count(*)::int` })
        .from(sheetScanBatches)
        .where(eq(sheetScanBatches.orgId, orgId))
        .groupBy(sheetScanBatches.status);

      const rejectReason = sql<string | null>`${sheetScans.quality} ->> 'rejectReason'`;
      const rejectRows = await tx
        .select({ key: rejectReason, count: sql<number>`count(*)::int` })
        .from(sheetScans)
        .where(and(eq(sheetScans.orgId, orgId), eq(sheetScans.state, 'quality_rejected')))
        .groupBy(rejectReason);

      const markRows = await tx
        .select({ key: sheetScanMarks.state, count: sql<number>`count(*)::int` })
        .from(sheetScanMarks)
        .where(eq(sheetScanMarks.orgId, orgId))
        .groupBy(sheetScanMarks.state);

      const [overrideRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sheetScanMarks)
        .where(
          and(
            eq(sheetScanMarks.orgId, orgId),
            inArray(sheetScanMarks.state, [...FIRM_MARK_STATES]),
            isNotNull(sheetScanMarks.reviewedValue),
            sql`${sheetScanMarks.reviewedValue} IS DISTINCT FROM ${sheetScanMarks.value}`,
          ),
        );

      return this.assembleResponse(batchRows, rejectRows, markRows, overrideRow?.count ?? 0);
    });
  }

  private assembleResponse(
    batchRows: CountByKey[],
    rejectRows: CountByKey[],
    markRows: CountByKey[],
    firmReadingOverrides: number,
  ): SheetScanMetricsResponse {
    const marksByState = this.countsToRecord(markRows, markStateEnum.enumValues);
    return {
      batchesByStatus: this.countsToRecord(batchRows, sheetScanBatchStatusEnum.enumValues),
      rejectedPagesByReason: this.countsToRecord(rejectRows, PAGE_REJECT_REASONS),
      marksByState,
      reviewRatePercent: this.reviewRatePercent(marksByState),
      firmReadingOverrides,
    };
  }

  private countsToRecord(rows: CountByKey[], knownKeys: readonly string[]): Record<string, number> {
    const record: Record<string, number> = {};
    for (const key of knownKeys) record[key] = 0;
    for (const row of rows) {
      const key = row.key ?? UNKNOWN_REJECT_REASON;
      record[key] = (record[key] ?? 0) + row.count;
    }
    return record;
  }

  private reviewRatePercent(marksByState: Record<string, number>): number {
    const total = Object.values(marksByState).reduce((sum, count) => sum + count, 0);
    if (total === 0) return 0;
    const toReview = REVIEW_MARK_STATES.reduce((sum, state) => sum + (marksByState[state] ?? 0), 0);
    return Math.round((toReview / total) * 1000) / 10;
  }
}
