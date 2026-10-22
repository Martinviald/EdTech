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
  reviewToMarkAnswer,
  REGISTRATION_ALERT_FALLBACK_RATIO,
  REGISTRATION_ALERT_OFF_MEDIAN_PX,
  type AiResolutionMetricsModel,
  type MarkAiResolution,
  type RegistrationMetricsModel,
  type SheetScanMetricsResponse,
  type SuggestionMetricsModel,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

const REVIEW_MARK_STATES = ['ambiguous', 'multiple'] as const;
const FIRM_MARK_STATES = ['marked', 'blank'] as const;
const UNKNOWN_REJECT_REASON = 'unknown';
const AUTO_SIMULATED_VERDICTS: ReadonlySet<string> = new Set([
  'agree',
  'solo_a',
  'solo_b',
  'audit_sample',
]);

const CROP_FIXED_MARK_CONDITION = sql`${sheetScanMarks.state} = 'marked' AND ${sheetScanMarks.fill} = 0 AND ${sheetScanMarks.threshold} = 0.5 AND ${sheetScanMarks.margin} = 1`;

type CountByKey = { key: string | null; count: number };
type SuggestionRow = {
  marksWithSuggestion: number;
  reviewed: number;
  confirmed: number;
};

type AiResolutionRow = {
  aiResolution: MarkAiResolution | null;
  reviewDecision: (typeof sheetScanMarks.$inferSelect)['reviewDecision'];
  reviewedValue: string | null;
  reviewedById: string | null;
};

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

      const suggestionMatches = sql`${sheetScanMarks.reviewedValue} = ${sheetScanMarks.suggestedValue}`;
      const [suggestionRow] = await tx
        .select({
          marksWithSuggestion: sql<number>`count(*)::int`,
          reviewed: sql<number>`count(*) filter (where ${sheetScanMarks.reviewedAt} is not null)::int`,
          confirmed: sql<number>`count(*) filter (where ${suggestionMatches})::int`,
        })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .where(and(activeScanMarks, isNotNull(sheetScanMarks.suggestedValue)));

      const aiResolutionRows = await tx
        .select({
          aiResolution: sheetScanMarks.aiResolution,
          reviewDecision: sheetScanMarks.reviewDecision,
          reviewedValue: sheetScanMarks.reviewedValue,
          reviewedById: sheetScanMarks.reviewedById,
        })
        .from(sheetScanMarks)
        .innerJoin(sheetScans, eq(sheetScans.id, sheetScanMarks.scanId))
        .where(and(activeScanMarks, isNotNull(sheetScanMarks.aiResolution)));

      return this.assembleResponse(
        batchRows,
        rejectRows,
        markRows,
        overrideRow?.count ?? 0,
        cropFixedRow?.count ?? 0,
        this.registrationMetrics(registrationRow),
        this.suggestionMetrics(suggestionRow),
        this.aiResolutionMetrics(aiResolutionRows),
      );
    });
  }

  private aiResolutionMetrics(rows: AiResolutionRow[]): AiResolutionMetricsModel {
    const metrics: AiResolutionMetricsModel = {
      evaluated: 0,
      autoSimulated: 0,
      autoApplied: 0,
      correctedByHuman: 0,
      agreementWithHuman: { compared: 0, agreed: 0 },
      byMode: { shadow: 0, live: 0 },
    };
    for (const row of rows) {
      const resolution = row.aiResolution;
      if (!resolution) continue;
      metrics.evaluated += 1;
      metrics.byMode[resolution.mode] += 1;
      const humanAnswer =
        row.reviewedById === null
          ? null
          : reviewToMarkAnswer(row.reviewDecision, row.reviewedValue);
      if (AUTO_SIMULATED_VERDICTS.has(resolution.verdict)) {
        metrics.autoSimulated += 1;
        if (humanAnswer !== null) {
          metrics.agreementWithHuman.compared += 1;
          if (humanAnswer === resolution.value) metrics.agreementWithHuman.agreed += 1;
        }
      }
      if (resolution.applied) {
        metrics.autoApplied += 1;
        if (humanAnswer !== null && humanAnswer !== resolution.value) {
          metrics.correctedByHuman += 1;
        }
      }
    }
    return metrics;
  }

  private suggestionMetrics(row: SuggestionRow | undefined): SuggestionMetricsModel {
    const reviewed = Number(row?.reviewed ?? 0);
    const confirmed = Number(row?.confirmed ?? 0);
    return {
      marksWithSuggestion: Number(row?.marksWithSuggestion ?? 0),
      reviewed,
      confirmed,
      rejected: reviewed - confirmed,
    };
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
    suggestions: SuggestionMetricsModel,
    aiResolutions: AiResolutionMetricsModel,
  ): SheetScanMetricsResponse {
    const marksByState = this.countsToRecord(markRows, markStateEnum.enumValues);
    return {
      batchesByStatus: this.countsToRecord(batchRows, sheetScanBatchStatusEnum.enumValues),
      rejectedPagesByReason: this.countsToRecord(rejectRows, PAGE_REJECT_REASONS),
      marksByState,
      reviewRatePercent: this.reviewRatePercent(marksByState, cropFixedMarks),
      firmReadingOverrides,
      registration,
      suggestions,
      aiResolutions,
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
