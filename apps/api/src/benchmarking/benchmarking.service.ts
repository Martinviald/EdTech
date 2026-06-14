import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  benchmarkAccessLogs,
  benchmarkAggregates,
  grades,
  instruments,
  organizations,
  subjects,
  withOrgContext,
  type BenchmarkAggregate,
} from '@soe/db';
import {
  BENCHMARK_K_MIN_SCHOOLS,
  BENCHMARK_N_MIN_STUDENTS,
  type BenchmarkAccessLogModel,
  type BenchmarkAuditListQueryDto,
  type BenchmarkAuditListResponse,
  type BenchmarkBandDistribution,
  type BenchmarkComparisonQueryDto,
  type BenchmarkComparisonResponse,
  type BenchmarkInstrumentListResponse,
  type BenchmarkInstrumentOption,
  type BenchmarkSkillAggregate,
  type CohortBenchmark,
  type CohortSkillStat,
  type NetworkSchoolRow,
  type SchoolBenchmark,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

const EMPTY_BANDS: BenchmarkBandDistribution = {
  insufficient: 0,
  elementary: 0,
  adequate: 0,
  advanced: 0,
};

const THRESHOLDS = {
  kMinSchools: BENCHMARK_K_MIN_SCHOOLS,
  nMinStudents: BENCHMARK_N_MIN_STUDENTS,
} as const;

/**
 * H7.2–H7.4 + H7.6 — Motor de comparación de benchmarking.
 *
 * ⚠️ EXCEPCIÓN CROSS-TENANT (la única del proyecto): `benchmark_aggregates` NO
 * tiene RLS y se lee con `this.db` FUERA de `withOrgContext`. Es deliberado: la
 * tabla solo contiene agregados sin PII. El aislamiento se garantiza por (a) los
 * guards de rol, (b) k-anonimato en modo global, (c) nunca exponer filas crudas
 * identificables de otra org en modo global. La auditoría (H7.6) y el listado de
 * `benchmark_access_logs` SÍ corren dentro de `withOrgContext(callerOrgId)` (esa
 * tabla sí tiene RLS).
 *
 * Las tablas `organizations`, `instruments`, `grades`, `subjects` NO tienen RLS
 * → se leen con `this.db` para resolver nombres y dimensiones de cohorte.
 */
@Injectable()
export class BenchmarkingService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/benchmarking/instruments (T5)
  // Instrumentos donde la org del caller tiene filas en el read-model.
  // ───────────────────────────────────────────────────────────────────────────

  async listInstruments(user: JwtPayload): Promise<BenchmarkInstrumentListResponse> {
    const orgId = this.requireOrgId(user);

    const rows = await this.db
      .select({
        instrumentId: benchmarkAggregates.instrumentId,
        instrumentName: instruments.name,
        gradeId: benchmarkAggregates.gradeId,
        gradeName: grades.name,
        subjectId: benchmarkAggregates.subjectId,
        subjectName: subjects.name,
        yourStudentCount: benchmarkAggregates.studentCount,
      })
      .from(benchmarkAggregates)
      .innerJoin(instruments, eq(benchmarkAggregates.instrumentId, instruments.id))
      .leftJoin(grades, eq(benchmarkAggregates.gradeId, grades.id))
      .leftJoin(subjects, eq(benchmarkAggregates.subjectId, subjects.id))
      .where(eq(benchmarkAggregates.orgId, orgId))
      .orderBy(asc(instruments.name));

    const data: BenchmarkInstrumentOption[] = rows.map((row) => ({
      instrumentId: row.instrumentId,
      instrumentName: row.instrumentName,
      gradeId: row.gradeId,
      gradeName: row.gradeName,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      yourStudentCount: row.yourStudentCount,
    }));

    return { data };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/benchmarking/comparison (T2–T4 + T6)
  // ───────────────────────────────────────────────────────────────────────────

  async compare(
    user: JwtPayload,
    query: BenchmarkComparisonQueryDto,
  ): Promise<BenchmarkComparisonResponse> {
    const orgId = this.requireOrgId(user);

    const instrumentName = await this.resolveInstrumentName(query.instrumentId);

    // La fila de TU colegio (cross-tenant read, pero filtrada por la org del token).
    const yourRow = await this.findYourRow(orgId, query);

    const response =
      query.mode === 'network'
        ? await this.compareNetwork(orgId, query, instrumentName, yourRow)
        : await this.compareGlobal(orgId, query, instrumentName, yourRow);

    // H7.6 — auditoría DENTRO de withOrgContext (tabla con RLS).
    await this.writeAccessLog(orgId, user.userId, query, response);

    return response;
  }

  // ── Modo GLOBAL: pool anónimo, excluye opt-out, k-anonimato ──

  private async compareGlobal(
    orgId: string,
    query: BenchmarkComparisonQueryDto,
    instrumentName: string,
    yourRow: BenchmarkAggregate | null,
  ): Promise<BenchmarkComparisonResponse> {
    const cohortRows = await this.fetchCohortRows(query, {
      includeOptOut: false,
      dependence: query.dependence,
      region: query.region,
      commune: query.commune,
    });

    const schoolCount = cohortRows.length;
    const studentCount = cohortRows.reduce((sum, r) => sum + r.studentCount, 0);

    // k-anonimato: < k colegios O < n alumnos → suprimir.
    if (
      schoolCount < BENCHMARK_K_MIN_SCHOOLS ||
      studentCount < BENCHMARK_N_MIN_STUDENTS
    ) {
      return {
        mode: 'global',
        instrumentId: query.instrumentId,
        instrumentName,
        suppressed: true,
        suppressionReason: `Cohorte insuficiente para anonimato (se requieren ≥ ${BENCHMARK_K_MIN_SCHOOLS} colegios y ≥ ${BENCHMARK_N_MIN_STUDENTS} alumnos)`,
        yourSchool: null,
        cohort: null,
        networkSchools: null,
        thresholds: { ...THRESHOLDS },
      };
    }

    const cohort = this.buildCohort(cohortRows, yourRow);
    const yourSchool = this.buildYourSchool(yourRow, cohortRows);

    return {
      mode: 'global',
      instrumentId: query.instrumentId,
      instrumentName,
      suppressed: false,
      suppressionReason: null,
      yourSchool,
      cohort,
      networkSchools: null,
      thresholds: { ...THRESHOLDS },
    };
  }

  // ── Modo RED: orgs con el mismo networkOrgId, identificado, sin k-anonimato ──

  private async compareNetwork(
    orgId: string,
    query: BenchmarkComparisonQueryDto,
    instrumentName: string,
    yourRow: BenchmarkAggregate | null,
  ): Promise<BenchmarkComparisonResponse> {
    const networkOrgId = await this.deriveNetworkOrgId(orgId);

    if (!networkOrgId) {
      return {
        mode: 'network',
        instrumentId: query.instrumentId,
        instrumentName,
        suppressed: false,
        suppressionReason: 'Tu colegio no pertenece a una red/sostenedor',
        yourSchool: this.buildYourSchool(yourRow, []),
        cohort: null,
        networkSchools: [],
        thresholds: { ...THRESHOLDS },
      };
    }

    // Red identificada: SIN supresión por k (acuerdo del sostenedor). Incluye
    // orgs con opt-out (la exclusión opt-out es solo del pool global anónimo).
    const networkRows = await this.fetchCohortRows(query, {
      includeOptOut: true,
      networkOrgId,
    });

    const orgNames = await this.resolveOrgNames(networkRows.map((r) => r.orgId));

    const networkSchools: NetworkSchoolRow[] = networkRows.map((row) => ({
      orgId: row.orgId,
      orgName: orgNames.get(row.orgId) ?? 'Colegio',
      isYou: row.orgId === orgId,
      avgAchievement: toNum(row.avgAchievement),
      studentCount: row.studentCount,
      bandDistribution: row.bandDistribution ?? { ...EMPTY_BANDS },
    }));

    return {
      mode: 'network',
      instrumentId: query.instrumentId,
      instrumentName,
      suppressed: false,
      suppressionReason: null,
      yourSchool: this.buildYourSchool(yourRow, networkRows),
      cohort: this.buildCohort(networkRows, yourRow),
      networkSchools,
      thresholds: { ...THRESHOLDS },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/benchmarking/audit (T6)
  // ───────────────────────────────────────────────────────────────────────────

  async listAudit(
    user: JwtPayload,
    query: BenchmarkAuditListQueryDto,
  ): Promise<BenchmarkAuditListResponse> {
    const orgId = this.requireOrgId(user);
    const offset = (query.page - 1) * query.limit;

    return withOrgContext(this.db, orgId, async (tx) => {
      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(benchmarkAccessLogs)
        .where(eq(benchmarkAccessLogs.orgId, orgId));

      const rows = await tx
        .select()
        .from(benchmarkAccessLogs)
        .where(eq(benchmarkAccessLogs.orgId, orgId))
        .orderBy(desc(benchmarkAccessLogs.createdAt))
        .limit(query.limit)
        .offset(offset);

      const data: BenchmarkAccessLogModel[] = rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        mode: row.mode,
        instrumentId: row.instrumentId,
        filters: row.filters,
        cohortSchoolCount: row.cohortSchoolCount,
        cohortStudentCount: row.cohortStudentCount,
        suppressed: row.suppressed,
        createdAt: row.createdAt.toISOString(),
      }));

      return { data, total, page: query.page, limit: query.limit };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers de cálculo
  // ───────────────────────────────────────────────────────────────────────────

  /** Construye el agregado de cohorte (median/p25/p75/avg/bandas/perSkill). */
  private buildCohort(
    rows: BenchmarkAggregate[],
    yourRow: BenchmarkAggregate | null,
  ): CohortBenchmark {
    const achievements = rows
      .map((r) => toNum(r.avgAchievement))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    const studentCount = rows.reduce((sum, r) => sum + r.studentCount, 0);
    const bandDistribution = this.sumBands(rows);

    return {
      schoolCount: rows.length,
      studentCount,
      avgAchievement: mean(achievements),
      median: percentileOf(achievements, 50),
      p25: percentileOf(achievements, 25),
      p75: percentileOf(achievements, 75),
      bandDistribution,
      perSkill: this.buildCohortSkills(rows, yourRow),
    };
  }

  /** Desempeño de tu colegio + percentil dentro de la cohorte. */
  private buildYourSchool(
    yourRow: BenchmarkAggregate | null,
    cohortRows: BenchmarkAggregate[],
  ): SchoolBenchmark | null {
    if (!yourRow) return null;

    const yourAchievement = toNum(yourRow.avgAchievement);
    const cohortAchievements = cohortRows
      .map((r) => toNum(r.avgAchievement))
      .filter((v): v is number => v !== null);

    return {
      avgAchievement: yourAchievement,
      studentCount: yourRow.studentCount,
      bandDistribution: yourRow.bandDistribution ?? { ...EMPTY_BANDS },
      percentile: percentileRank(cohortAchievements, yourAchievement),
      perSkill: yourRow.perSkill ?? [],
    };
  }

  /** Mezcla las habilidades de la cohorte (avg) contra las de tu colegio (delta). */
  private buildCohortSkills(
    rows: BenchmarkAggregate[],
    yourRow: BenchmarkAggregate | null,
  ): CohortSkillStat[] {
    // Acumula achievement ponderado por studentCount para cada nodeId.
    const acc = new Map<string, { name: string; sum: number; count: number }>();
    for (const row of rows) {
      for (const skill of row.perSkill ?? []) {
        if (skill.achievement === null) continue;
        const entry = acc.get(skill.nodeId) ?? {
          name: skill.nodeName,
          sum: 0,
          count: 0,
        };
        entry.sum += skill.achievement * skill.studentCount;
        entry.count += skill.studentCount;
        acc.set(skill.nodeId, entry);
      }
    }

    const yourSkills = new Map<string, BenchmarkSkillAggregate>();
    for (const skill of yourRow?.perSkill ?? []) {
      yourSkills.set(skill.nodeId, skill);
    }

    const result: CohortSkillStat[] = [];
    for (const [nodeId, entry] of acc) {
      const cohortAchievement = entry.count > 0 ? round2(entry.sum / entry.count) : null;
      const yourAchievement = yourSkills.get(nodeId)?.achievement ?? null;
      const delta =
        cohortAchievement !== null && yourAchievement !== null
          ? round2(yourAchievement - cohortAchievement)
          : null;
      result.push({
        nodeId,
        nodeName: entry.name,
        cohortAchievement,
        yourAchievement,
        delta,
      });
    }
    return result.sort((a, b) => a.nodeName.localeCompare(b.nodeName));
  }

  private sumBands(rows: BenchmarkAggregate[]): BenchmarkBandDistribution {
    return rows.reduce<BenchmarkBandDistribution>(
      (acc, row) => {
        const b = row.bandDistribution ?? EMPTY_BANDS;
        return {
          insufficient: acc.insufficient + b.insufficient,
          elementary: acc.elementary + b.elementary,
          adequate: acc.adequate + b.adequate,
          advanced: acc.advanced + b.advanced,
        };
      },
      { ...EMPTY_BANDS },
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Acceso a datos (read-model cross-tenant + auditoría en contexto)
  // ───────────────────────────────────────────────────────────────────────────

  /** Filas de la cohorte del read-model. CROSS-TENANT (this.db, sin contexto). */
  private async fetchCohortRows(
    query: BenchmarkComparisonQueryDto,
    opts: {
      includeOptOut: boolean;
      dependence?: string;
      region?: string;
      commune?: string;
      networkOrgId?: string;
    },
  ): Promise<BenchmarkAggregate[]> {
    const conditions = [eq(benchmarkAggregates.instrumentId, query.instrumentId)];

    if (query.gradeId) {
      conditions.push(eq(benchmarkAggregates.gradeId, query.gradeId));
    }
    if (query.subjectId) {
      conditions.push(eq(benchmarkAggregates.subjectId, query.subjectId));
    }
    if (!opts.includeOptOut) {
      conditions.push(eq(benchmarkAggregates.optOutGlobalPool, false));
    }
    if (opts.dependence) {
      conditions.push(
        sql`${benchmarkAggregates.dependence}::text = ${opts.dependence}`,
      );
    }
    if (opts.region) {
      conditions.push(eq(benchmarkAggregates.region, opts.region));
    }
    if (opts.commune) {
      conditions.push(eq(benchmarkAggregates.commune, opts.commune));
    }
    if (opts.networkOrgId) {
      conditions.push(eq(benchmarkAggregates.networkOrgId, opts.networkOrgId));
    }

    return this.db
      .select()
      .from(benchmarkAggregates)
      .where(and(...conditions));
  }

  /** Fila de tu colegio en el read-model. CROSS-TENANT pero filtrada por tu org. */
  private async findYourRow(
    orgId: string,
    query: BenchmarkComparisonQueryDto,
  ): Promise<BenchmarkAggregate | null> {
    const conditions = [
      eq(benchmarkAggregates.orgId, orgId),
      eq(benchmarkAggregates.instrumentId, query.instrumentId),
    ];
    if (query.gradeId) {
      conditions.push(eq(benchmarkAggregates.gradeId, query.gradeId));
    } else {
      conditions.push(isNull(benchmarkAggregates.gradeId));
    }
    if (query.subjectId) {
      conditions.push(eq(benchmarkAggregates.subjectId, query.subjectId));
    } else {
      conditions.push(isNull(benchmarkAggregates.subjectId));
    }

    const [row] = await this.db
      .select()
      .from(benchmarkAggregates)
      .where(and(...conditions))
      .limit(1);
    return row ?? null;
  }

  /** H7.6 — escribe una fila de auditoría dentro de withOrgContext. */
  private async writeAccessLog(
    orgId: string,
    userId: string,
    query: BenchmarkComparisonQueryDto,
    response: BenchmarkComparisonResponse,
  ): Promise<void> {
    const cohortSchoolCount = response.cohort?.schoolCount ?? null;
    const cohortStudentCount = response.cohort?.studentCount ?? null;
    const filters: Record<string, unknown> = {};
    if (query.gradeId) filters.gradeId = query.gradeId;
    if (query.subjectId) filters.subjectId = query.subjectId;
    if (query.dependence) filters.dependence = query.dependence;
    if (query.region) filters.region = query.region;
    if (query.commune) filters.commune = query.commune;

    await withOrgContext(this.db, orgId, async (tx) => {
      await tx.insert(benchmarkAccessLogs).values({
        orgId,
        userId,
        mode: query.mode,
        instrumentId: query.instrumentId,
        filters: Object.keys(filters).length > 0 ? filters : null,
        cohortSchoolCount,
        cohortStudentCount,
        suppressed: response.suppressed,
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lookups sin RLS (organizations / instruments)
  // ───────────────────────────────────────────────────────────────────────────

  private async resolveInstrumentName(instrumentId: string): Promise<string> {
    const [row] = await this.db
      .select({ name: instruments.name })
      .from(instruments)
      .where(eq(instruments.id, instrumentId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Instrumento no encontrado');
    }
    return row.name;
  }

  private async resolveOrgNames(orgIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (orgIds.length === 0) return names;
    const rows = await this.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations);
    for (const row of rows) {
      if (orgIds.includes(row.id)) names.set(row.id, row.name);
    }
    return names;
  }

  /** Red del caller: parentId solo si el padre es foundation. */
  private async deriveNetworkOrgId(orgId: string): Promise<string | null> {
    const [org] = await this.db
      .select({ parentId: organizations.parentId })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org?.parentId) return null;
    const [parent] = await this.db
      .select({ id: organizations.id, type: organizations.type })
      .from(organizations)
      .where(eq(organizations.id, org.parentId))
      .limit(1);
    return parent && parent.type === 'foundation' ? parent.id : null;
  }

  private requireOrgId(user: JwtPayload): string {
    if (user.orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }
    return user.orgId;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades numéricas puras (sin estado, fácilmente testeables)
// ─────────────────────────────────────────────────────────────────────────────

function toNum(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mean(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  return round2(sorted.reduce((a, b) => a + b, 0) / sorted.length);
}

/** Percentil (interpolación lineal) sobre un array ya ordenado ascendente. */
function percentileOf(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return round2(sorted[0]);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return round2(sorted[low]);
  const weight = rank - low;
  return round2(sorted[low] * (1 - weight) + sorted[high] * weight);
}

/**
 * Posición percentil de `value` dentro de `values` (0..100). Método de "rango
 * percentil": % de valores estrictamente menores + mitad de los iguales.
 */
function percentileRank(values: number[], value: number | null): number | null {
  if (value === null || values.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return round2(((below + equal / 2) / values.length) * 100);
}
