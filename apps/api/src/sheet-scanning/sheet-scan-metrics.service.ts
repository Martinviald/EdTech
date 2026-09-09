import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import {
  markStateEnum,
  sheetScanBatchStatusEnum,
  sheetScanBatches,
  sheetScanMarks,
  sheetScans,
  withOrgContext,
} from '@soe/db';
import {
  PAGE_REJECT_REASONS,
  REGISTRATION_ALERT_FALLBACK_RATIO,
  REGISTRATION_ALERT_OFF_MEDIAN_PX,
  type RegistrationMetricsModel,
  type SheetScanMetricsResponse,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

const REVIEW_MARK_STATES = ['ambiguous', 'multiple'] as const;
const FIRM_MARK_STATES = ['marked', 'blank'] as const;
const UNKNOWN_REJECT_REASON = 'unknown';

const CROP_FIXED_MARK_CONDITION = sql`${sheetScanMarks.state} = 'marked' AND ${sheetScanMarks.fill} = 0 AND ${sheetScanMarks.threshold} = 0.5 AND ${sheetScanMarks.margin} = 1`;

type CountByKey = { key: string | null; count: number };
type RegistrationRow = {
  pages: number;
  offMedianPxAvg: number | string | null;
  offMaxPxMax: number | string | null;
  fallbackPages: number;
  offsetAlertPages: number;
  fallbackAlertPages: number;
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

      const activeScanMarks = and(
        eq(sheetScanMarks.orgId, orgId),
        ne(sheetScans.state, 'superseded'),
      );
      const markRows = await tx
        .select({ key: sheetScanMarks.state, count: sql<number>`count(*)::int` })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .where(activeScanMarks)
        .groupBy(sheetScanMarks.state);

      const [overrideRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .where(
          and(
            activeScanMarks,
            inArray(sheetScanMarks.state, [...FIRM_MARK_STATES]),
            or(
              eq(sheetScanMarks.reviewDecision, 'annulled'),
              and(
                isNotNull(sheetScanMarks.reviewedValue),
                sql`${sheetScanMarks.reviewedValue} IS DISTINCT FROM ${sheetScanMarks.value}`,
              ),
            ),
          ),
        );

      const [cropFixedRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .where(and(activeScanMarks, CROP_FIXED_MARK_CONDITION));

      const registration = sql`${sheetScans.diagnostics} -> 'registration'`;
      const fallbackCount = sql`coalesce((${registration} ->> 'fallbackCount')::int, 0)`;
      const bubbles = sql`coalesce((${registration} ->> 'bubbles')::int, 0)`;
      const offMedianPx = sql`(${registration} ->> 'offMedianPx')::numeric`;
      const [registrationRow] = await tx
        .select({
          pages: sql<number>`count(*)::int`,
          offMedianPxAvg: sql<number | null>`avg(${offMedianPx})`,
          offMaxPxMax: sql<number | null>`max((${registration} ->> 'offMaxPx')::numeric)`,
          fallbackPages: sql<number>`count(*) filter (where ${fallbackCount} > 0)::int`,
          offsetAlertPages: sql<number>`count(*) filter (where ${offMedianPx} > ${REGISTRATION_ALERT_OFF_MEDIAN_PX})::int`,
          fallbackAlertPages: sql<number>`count(*) filter (where ${bubbles} > 0 and ${fallbackCount}::numeric / ${bubbles} > ${REGISTRATION_ALERT_FALLBACK_RATIO})::int`,
        })
        .from(sheetScans)
        .where(
          and(
            eq(sheetScans.orgId, orgId),
            ne(sheetScans.state, 'superseded'),
            isNotNull(sheetScans.diagnostics),
          ),
        );

      return this.assembleResponse(
        batchRows,
        rejectRows,
        markRows,
        overrideRow?.count ?? 0,
        cropFixedRow?.count ?? 0,
        this.registrationMetrics(registrationRow),
      );
    });
  }

  private registrationMetrics(row: RegistrationRow | undefined): RegistrationMetricsModel {
    const round1 = (value: number) => Math.round(value * 10) / 10;
    return {
      pagesWithDiagnostics: Number(row?.pages ?? 0),
      offMedianPxAvg: row?.offMedianPxAvg == null ? null : round1(Number(row.offMedianPxAvg)),
      offMaxPxMax: row?.offMaxPxMax == null ? null : round1(Number(row.offMaxPxMax)),
      fallbackPages: Number(row?.fallbackPages ?? 0),
      offsetAlertPages: Number(row?.offsetAlertPages ?? 0),
      fallbackAlertPages: Number(row?.fallbackAlertPages ?? 0),
      alerts: {
        offMedianPx: REGISTRATION_ALERT_OFF_MEDIAN_PX,
        fallbackRatio: REGISTRATION_ALERT_FALLBACK_RATIO,
      },
    };
  }

  private assembleResponse(
    batchRows: CountByKey[],
    rejectRows: CountByKey[],
    markRows: CountByKey[],
    firmReadingOverrides: number,
    cropFixedMarks: number,
    registration: RegistrationMetricsModel,
  ): SheetScanMetricsResponse {
    const marksByState = this.countsToRecord(markRows, markStateEnum.enumValues);
    return {
      batchesByStatus: this.countsToRecord(batchRows, sheetScanBatchStatusEnum.enumValues),
      rejectedPagesByReason: this.countsToRecord(rejectRows, PAGE_REJECT_REASONS),
      marksByState,
      reviewRatePercent: this.reviewRatePercent(marksByState, cropFixedMarks),
      firmReadingOverrides,
      registration,
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

  private reviewRatePercent(marksByState: Record<string, number>, cropFixedMarks: number): number {
    const total =
      Object.values(marksByState).reduce((sum, count) => sum + count, 0) - cropFixedMarks;
    if (total <= 0) return 0;
    const toReview = REVIEW_MARK_STATES.reduce((sum, state) => sum + (marksByState[state] ?? 0), 0);
    return Math.round((toReview / total) * 1000) / 10;
  }
}
