import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  benchmarkAccessLogs,
  benchmarkAggregates,
  benchmarkItemAggregates,
  organizations,
  withOrgContext,
  type BenchmarkAggregate,
} from '@soe/db';
import {
  BENCHMARK_K_MIN_SCHOOLS,
  BENCHMARK_N_MIN_STUDENTS,
  aggregateItemSample,
  aggregateSample,
  classifyTypicalZone,
  percentileRank,
  type BenchmarkSampleScope,
  type InstrumentItemSamples,
  type InstrumentItemSamplesResponse,
  type InstrumentSample,
  type InstrumentSampleEntry,
  type InstrumentSamplesQueryDto,
  type InstrumentSamplesResponse,
  type YourSamplePosition,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

const GLOBAL_SAMPLE_LABEL = 'Muestra';

type NetworkRef = { id: string; name: string };

@Injectable()
export class BenchmarkSamplesService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getSamplesForUser(
    user: JwtPayload,
    query: InstrumentSamplesQueryDto,
  ): Promise<InstrumentSamplesResponse> {
    if (user.orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }
    const data = await this.getSamples(user.orgId, query.instrumentIds);
    await this.writeAccessLog(user.orgId, user.userId, query.instrumentIds);
    return { data };
  }

  async getItemSamplesForUser(
    user: JwtPayload,
    query: InstrumentSamplesQueryDto,
  ): Promise<InstrumentItemSamplesResponse> {
    if (user.orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }
    const data = await this.getItemSamples(query.instrumentIds);
    await this.writeAccessLog(user.orgId, user.userId, query.instrumentIds);
    return { data };
  }

  async getItemSamples(
    instrumentIds: readonly string[],
    db: Database = this.db,
  ): Promise<InstrumentItemSamples[]> {
    const uniqueIds = Array.from(new Set(instrumentIds));
    if (uniqueIds.length === 0) return [];

    const rows = await db
      .select({
        orgId: benchmarkItemAggregates.orgId,
        instrumentId: benchmarkItemAggregates.instrumentId,
        itemId: benchmarkItemAggregates.itemId,
        correctCount: benchmarkItemAggregates.correctCount,
        responseCount: benchmarkItemAggregates.responseCount,
        refreshedAt: benchmarkItemAggregates.refreshedAt,
      })
      .from(benchmarkItemAggregates)
      .where(
        and(
          inArray(benchmarkItemAggregates.instrumentId, uniqueIds),
          eq(benchmarkItemAggregates.optOutGlobalPool, false),
        ),
      );

    const rowsByInstrument = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = rowsByInstrument.get(row.instrumentId);
      if (bucket) bucket.push(row);
      else rowsByInstrument.set(row.instrumentId, [row]);
    }

    const samples: InstrumentItemSamples[] = [];
    for (const [instrumentId, instrumentRows] of rowsByInstrument) {
      const aggregate = aggregateItemSample(instrumentRows);
      if (
        aggregate.schoolCount < BENCHMARK_K_MIN_SCHOOLS ||
        aggregate.studentCount < BENCHMARK_N_MIN_STUDENTS
      ) {
        continue;
      }
      let refreshedAt = instrumentRows[0]!.refreshedAt;
      for (const row of instrumentRows) {
        if (row.refreshedAt > refreshedAt) refreshedAt = row.refreshedAt;
      }
      samples.push({
        instrumentId,
        ...aggregate,
        items: aggregate.items.filter((item) => item.schoolCount >= BENCHMARK_K_MIN_SCHOOLS),
        refreshedAt: refreshedAt.toISOString(),
      });
    }
    return samples;
  }

  async getSamples(
    orgId: string,
    instrumentIds: readonly string[],
    db: Database = this.db,
  ): Promise<InstrumentSampleEntry[]> {
    const uniqueIds = Array.from(new Set(instrumentIds));
    if (uniqueIds.length === 0) return [];

    const [rows, network] = await Promise.all([
      db
        .select()
        .from(benchmarkAggregates)
        .where(inArray(benchmarkAggregates.instrumentId, uniqueIds)),
      this.resolveNetwork(orgId, db),
    ]);

    const rowsByInstrument = new Map<string, BenchmarkAggregate[]>();
    for (const row of rows) {
      const bucket = rowsByInstrument.get(row.instrumentId);
      if (bucket) bucket.push(row);
      else rowsByInstrument.set(row.instrumentId, [row]);
    }

    return uniqueIds.map((instrumentId) =>
      this.buildEntry(instrumentId, rowsByInstrument.get(instrumentId) ?? [], orgId, network),
    );
  }

  private buildEntry(
    instrumentId: string,
    rows: BenchmarkAggregate[],
    orgId: string,
    network: NetworkRef | null,
  ): InstrumentSampleEntry {
    const globalRows = rows.filter((row) => !row.optOutGlobalPool);
    const networkRows = network ? rows.filter((row) => row.networkOrgId === network.id) : [];
    const yourRow = rows.find((row) => row.orgId === orgId) ?? null;

    const global = this.satisfiesAnonymity(globalRows)
      ? this.buildSample(instrumentId, 'global', GLOBAL_SAMPLE_LABEL, globalRows)
      : null;
    const networkSample =
      network && networkRows.length > 0
        ? this.buildSample(instrumentId, 'network', network.name, networkRows)
        : null;

    return {
      instrumentId,
      global,
      network: networkSample,
      you: yourRow ? this.buildPosition(yourRow, globalRows, global) : null,
    };
  }

  private satisfiesAnonymity(rows: BenchmarkAggregate[]): boolean {
    let students = 0;
    for (const row of rows) students += row.studentCount;
    return rows.length >= BENCHMARK_K_MIN_SCHOOLS && students >= BENCHMARK_N_MIN_STUDENTS;
  }

  private buildSample(
    instrumentId: string,
    scope: BenchmarkSampleScope,
    label: string,
    rows: BenchmarkAggregate[],
  ): InstrumentSample {
    const aggregate = aggregateSample(
      rows.map((row) => ({
        studentCount: row.studentCount,
        avgAchievement: this.toNumber(row.avgAchievement),
        bandCounts: row.bandCounts,
        perSkill: row.perSkill,
      })),
    );
    let refreshedAt = rows[0]!.refreshedAt;
    for (const row of rows) {
      if (row.refreshedAt > refreshedAt) refreshedAt = row.refreshedAt;
    }
    return { instrumentId, scope, label, ...aggregate, refreshedAt: refreshedAt.toISOString() };
  }

  private buildPosition(
    yourRow: BenchmarkAggregate,
    globalRows: BenchmarkAggregate[],
    global: InstrumentSample | null,
  ): YourSamplePosition {
    const yourAchievement = this.toNumber(yourRow.avgAchievement);
    const schoolAchievements = globalRows
      .map((row) => this.toNumber(row.avgAchievement))
      .filter((value): value is number => value !== null);
    return {
      avgAchievement: yourAchievement,
      studentCount: yourRow.studentCount,
      percentile: global ? percentileRank(schoolAchievements, yourAchievement) : null,
      typicalZone: global ? classifyTypicalZone(yourAchievement, global.p25, global.p75) : null,
    };
  }

  private toNumber(value: string | number | null): number | null {
    if (value === null) return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private async resolveNetwork(orgId: string, db: Database): Promise<NetworkRef | null> {
    const [org] = await db
      .select({ parentId: organizations.parentId })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org?.parentId) return null;
    const [parent] = await db
      .select({ id: organizations.id, name: organizations.name, type: organizations.type })
      .from(organizations)
      .where(eq(organizations.id, org.parentId))
      .limit(1);
    return parent && parent.type === 'foundation' ? { id: parent.id, name: parent.name } : null;
  }

  private async writeAccessLog(
    orgId: string,
    userId: string,
    instrumentIds: readonly string[],
  ): Promise<void> {
    await withOrgContext(this.db, orgId, async (tx) => {
      await tx.insert(benchmarkAccessLogs).values({
        orgId,
        userId,
        mode: 'global',
        instrumentId: null,
        filters: { instrumentIds: [...instrumentIds] },
        cohortSchoolCount: null,
        cohortStudentCount: null,
        suppressed: false,
      });
    });
  }
}
