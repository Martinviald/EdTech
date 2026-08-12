import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessments,
  classGroups,
  grades,
  instruments,
  subjects,
  withOrgContext,
} from '@soe/db';
import {
  buildComparabilityMeta,
  deltaInPoints,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  INSTRUMENT_APPLICATION_PERIODS,
  type BaselineRef,
  type ComparabilityInstrumentRef,
  type ComparableTrajectoryPoint,
  type ComparableTrajectoryQueryDto,
  type ComparableTrajectoryResponse,
  type ComparableUnitClassGroup,
  type InstrumentApplicationPeriod,
  type PerformanceBandInput,
  type PerformanceBandView,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { resolveClassGroupScope } from '../common/helpers/class-group-scope.helper';
import {
  ComparableUnitAssembler,
  type BaselineCandidate,
} from '../dashboards/comparable/comparable-unit.assembler';
import { InjectDb, type Database } from '../database/database.types';
import { loadInstrumentBands } from '../performance-bands/lib/load-instrument-bands';

type FamilyRow = {
  assessmentId: string;
  instrumentId: string;
  instrumentName: string;
  year: number | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  administeredAt: Date | null;
};

type RawPoint = {
  key: string;
  label: string;
  year: number | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  instrumentId: string;
  instrumentName: string;
  assessmentIds: string[];
  administeredAt: Date | null;
};

/**
 * GET /api/analytics/comparable-trajectory — la vista unificada de "Trayectoria comparable".
 *
 * Una familia comparable (tipo + asignatura + nivel) a lo largo de UN eje:
 *
 *  - `years`   → fija el momento del ciclo y recorre los años (N2, la comparación
 *                generacional: la misma medición contra la generación anterior).
 *  - `moments` → recorre TODAS las aplicaciones de la familia en orden cronológico
 *                (año, luego momento del ciclo): los momentos de los años anteriores y
 *                los de este año hasta hoy (N4 `instrument_history`). Acotable a un año
 *                concreto con `year`, y ahí degenera en la serie N3 de ese ciclo.
 *
 * Cada punto es una aplicación comparable; su % de logro es legítimo porque sale del mismo
 * instrumento y del mismo corte — nunca se promedia entre puntos. Reutiliza
 * `ComparableUnitAssembler` para el cómputo de logro, distribución por banda, desglose por
 * curso y baselines — la misma maquinaria que la matriz del Panorama, sin re-derivar.
 */
@Injectable()
export class ComparableTrajectoryService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly assembler: ComparableUnitAssembler,
  ) {}

  async trajectory(
    user: JwtPayload,
    query: ComparableTrajectoryQueryDto,
  ): Promise<ComparableTrajectoryResponse> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await resolveClassGroupScope(tx, user, orgId);
      const meta = await this.resolveMeta(tx, query);
      const emptyScope = scope.scopeAll ? 'org' : 'teacher';

      const classGroupIds = await this.resolveClassGroupIds(tx, orgId, scope, query.classGroupId);
      if (classGroupIds !== null && classGroupIds.length === 0) {
        return this.emptyResponse(query, meta, emptyScope, []);
      }

      const rows = await this.loadFamilyRows(tx, orgId, query, classGroupIds);
      if (rows.length === 0) return this.emptyResponse(query, meta, emptyScope, []);

      const rawPoints = this.buildPoints(rows, query);
      if (rawPoints.length === 0) return this.emptyResponse(query, meta, emptyScope, []);

      const refs = rawPoints.map((p) => this.refOf(query, p));
      const assessmentCount = rawPoints.reduce((acc, p) => acc + p.assessmentIds.length, 0);
      const comparability = buildComparabilityMeta(refs, assessmentCount);

      const allAssessmentIds = rawPoints.flatMap((p) => p.assessmentIds);
      const achievementByAssessment = await this.assembler.loadAchievementByAssessment(
        tx,
        allAssessmentIds,
        classGroupIds,
      );

      const bandsByInstrument = new Map<string, PerformanceBandInput[]>();
      const series: ComparableTrajectoryPoint[] = [];
      for (const raw of rawPoints) {
        const bands = await this.bandsFor(tx, raw.instrumentId, bandsByInstrument);
        const { achievement, students } = this.assembler.foldAchievement(
          raw.assessmentIds,
          achievementByAssessment,
        );
        const bandDistribution =
          bands.length > 0
            ? await this.assembler.resolveBandDistribution(
                tx,
                raw.assessmentIds,
                classGroupIds,
                bands,
              )
            : null;
        series.push({
          key: raw.key,
          label: raw.label,
          year: raw.year,
          applicationPeriod: raw.applicationPeriod,
          instrumentId: raw.instrumentId,
          instrumentName: raw.instrumentName,
          assessmentIds: raw.assessmentIds,
          administeredAt: raw.administeredAt,
          studentsAssessed: students,
          averageAchievement: achievement,
          bandDistribution,
        });
      }

      const current = series[series.length - 1] ?? null;
      const currentRaw = rawPoints[rawPoints.length - 1] ?? null;
      const currentBands = current ? (bandsByInstrument.get(current.instrumentId) ?? []) : [];

      const byClassGroup: ComparableUnitClassGroup[] = current
        ? await this.assembler.loadByClassGroup(
            tx,
            orgId,
            current.assessmentIds,
            classGroupIds,
            currentBands,
          )
        : [];

      const baselines = currentRaw
        ? await this.resolveBaselines(
            tx,
            orgId,
            this.refOf(query, currentRaw),
            current,
            classGroupIds,
          )
        : { previousPeriod: null, previousYear: null };

      return {
        scope: emptyScope,
        axis: query.axis,
        gradeId: query.gradeId,
        gradeName: meta.gradeName,
        subjectId: query.subjectId,
        subjectName: meta.subjectName,
        instrumentType: query.instrumentType,
        applicationPeriod: query.axis === 'years' ? (query.applicationPeriod ?? null) : null,
        classGroupId: query.classGroupId ?? null,
        classGroupName: meta.classGroupName,
        bands: currentBands.length > 0 ? currentBands.map(toBandView) : null,
        series,
        current,
        byClassGroup,
        baselines,
        comparability,
      };
    });
  }

  // ── Carga de la familia ──────────────────────────────────────────────────────

  private async loadFamilyRows(
    tx: Database,
    orgId: string,
    query: ComparableTrajectoryQueryDto,
    classGroupIds: string[] | null,
  ): Promise<FamilyRow[]> {
    const conditions = [
      eq(assessments.orgId, orgId),
      isNull(instruments.deletedAt),
      sql`${instruments.type}::text = ${query.instrumentType}`,
      eq(instruments.subjectId, query.subjectId),
      eq(instruments.gradeId, query.gradeId),
    ];
    if (classGroupIds !== null) {
      conditions.push(
        inArray(
          assessments.id,
          tx
            .select({ id: assessmentCourseAssignments.assessmentId })
            .from(assessmentCourseAssignments)
            .where(inArray(assessmentCourseAssignments.classGroupId, classGroupIds)),
        ),
      );
    }

    const rows = await tx
      .select({
        assessmentId: assessments.id,
        instrumentId: instruments.id,
        instrumentName: instruments.name,
        year: instruments.year,
        applicationPeriod: instruments.applicationPeriod,
        administeredAt: assessments.administeredAt,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(and(...conditions));

    return rows;
  }

  // ── Agrupación por eje ───────────────────────────────────────────────────────

  private buildPoints(rows: FamilyRow[], query: ComparableTrajectoryQueryDto): RawPoint[] {
    if (query.axis === 'years') {
      const fixedPeriod = query.applicationPeriod ?? null;
      const matching = rows.filter((r) => r.applicationPeriod === fixedPeriod);
      const byYear = this.groupPoints(matching, (r) => (r.year == null ? 'none' : String(r.year)));
      return Array.from(byYear.values())
        .map((rs) => this.toRawPoint(rs, 'year'))
        .sort(
          (a, b) => (a.year ?? Number.POSITIVE_INFINITY) - (b.year ?? Number.POSITIVE_INFINITY),
        );
    }

    const matching = query.year == null ? rows : rows.filter((r) => r.year === query.year);
    const byApplication = this.groupPoints(
      matching,
      (r) => `${r.year ?? 'none'}|${r.applicationPeriod ?? 'none'}`,
    );
    return Array.from(byApplication.values())
      .map((rs) => this.toRawPoint(rs, 'period'))
      .sort((a, b) => this.compareChronologically(a, b));
  }

  private compareChronologically(a: RawPoint, b: RawPoint): number {
    const yearA = a.year ?? Number.POSITIVE_INFINITY;
    const yearB = b.year ?? Number.POSITIVE_INFINITY;
    if (yearA !== yearB) return yearA - yearB;
    return this.periodRank(a.applicationPeriod) - this.periodRank(b.applicationPeriod);
  }

  private groupPoints(
    rows: FamilyRow[],
    keyOf: (r: FamilyRow) => string,
  ): Map<string, FamilyRow[]> {
    const byKey = new Map<string, FamilyRow[]>();
    for (const row of rows) {
      const key = keyOf(row);
      const list = byKey.get(key);
      if (list) list.push(row);
      else byKey.set(key, [row]);
    }
    return byKey;
  }

  private toRawPoint(rows: FamilyRow[], axis: 'year' | 'period'): RawPoint {
    const first = rows[0]!;
    const assessmentIds = Array.from(new Set(rows.map((r) => r.assessmentId)));
    const administeredAt = rows.reduce<Date | null>((max, r) => {
      if (!r.administeredAt) return max;
      return max === null || r.administeredAt > max ? r.administeredAt : max;
    }, null);
    const key =
      axis === 'year'
        ? first.year == null
          ? 'none'
          : String(first.year)
        : `${first.year ?? 'none'}-${first.applicationPeriod ?? 'none'}`;
    const label =
      axis === 'year'
        ? first.year == null
          ? 'Sin año'
          : String(first.year)
        : this.applicationLabel(first);
    return {
      key,
      label,
      year: first.year,
      applicationPeriod: first.applicationPeriod,
      instrumentId: first.instrumentId,
      instrumentName: first.instrumentName,
      assessmentIds,
      administeredAt,
    };
  }

  private applicationLabel(row: FamilyRow): string {
    const period = row.applicationPeriod
      ? INSTRUMENT_APPLICATION_PERIOD_LABELS[row.applicationPeriod]
      : 'Sin momento';
    return row.year == null ? period : `${period} ${row.year}`;
  }

  private periodRank(period: InstrumentApplicationPeriod | null): number {
    if (!period) return INSTRUMENT_APPLICATION_PERIODS.length;
    return INSTRUMENT_APPLICATION_PERIODS.indexOf(period);
  }

  // ── Baselines ────────────────────────────────────────────────────────────────

  private async resolveBaselines(
    tx: Database,
    orgId: string,
    ref: ComparabilityInstrumentRef,
    current: ComparableTrajectoryPoint,
    classGroupIds: string[] | null,
  ): Promise<{ previousPeriod: BaselineRef | null; previousYear: BaselineRef | null }> {
    const candidates = await this.assembler.loadBaselineCandidates(tx, orgId, [ref]);
    const choices = this.assembler.resolveBaselineChoices(ref, candidates);
    const [previousPeriod, previousYear] = await Promise.all([
      this.toBaselineRef(
        tx,
        'previous_period',
        choices.previousPeriod,
        current,
        ref,
        classGroupIds,
      ),
      this.toBaselineRef(tx, 'previous_year', choices.previousYear, current, ref, classGroupIds),
    ]);
    return { previousPeriod, previousYear };
  }

  private async toBaselineRef(
    tx: Database,
    kind: BaselineRef['kind'],
    candidate: BaselineCandidate | null,
    current: ComparableTrajectoryPoint,
    ref: ComparabilityInstrumentRef,
    classGroupIds: string[] | null,
  ): Promise<BaselineRef | null> {
    if (!candidate || candidate.instrumentId === ref.instrumentId) return null;
    const achievement = await this.assembler.baselineAchievement(
      tx,
      candidate.assessmentIds,
      classGroupIds,
    );
    return {
      kind,
      label: candidate.label,
      instrumentId: candidate.instrumentId,
      assessmentIds: candidate.assessmentIds,
      achievement,
      deltaPp: deltaInPoints(current.averageAchievement, achievement),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async bandsFor(
    tx: Database,
    instrumentId: string,
    cache: Map<string, PerformanceBandInput[]>,
  ): Promise<PerformanceBandInput[]> {
    const cached = cache.get(instrumentId);
    if (cached) return cached;
    const bands = await loadInstrumentBands(tx, instrumentId);
    cache.set(instrumentId, bands);
    return bands;
  }

  private refOf(query: ComparableTrajectoryQueryDto, point: RawPoint): ComparabilityInstrumentRef {
    return {
      instrumentId: point.instrumentId,
      type: query.instrumentType,
      subjectId: query.subjectId,
      gradeId: query.gradeId,
      applicationPeriod: point.applicationPeriod,
      year: point.year,
    };
  }

  /**
   * Los ids de `class_groups` que acotan la trayectoria.
   *
   * `class_groups` es POR año académico: "3º A" de 2025 y "3º A" de 2026 son filas
   * distintas. Filtrar por el id elegido a secas colapsaría la trayectoria al año de esa
   * fila — justo lo contrario de lo que la vista promete. Así que el curso elegido se
   * resuelve a su MISMO curso (mismo nivel + misma letra) en todos los años de la org.
   *
   * Un profesor sigue viendo sólo los cursos donde tiene asignación (CLAUDE.md §6.3): la
   * expansión se intersecta con su alcance, no lo amplía.
   */
  private async resolveClassGroupIds(
    tx: Database,
    orgId: string,
    scope: { scopeAll: boolean; classGroupIds: string[] },
    classGroupId: string | undefined,
  ): Promise<string[] | null> {
    if (!classGroupId) {
      if (scope.scopeAll) return null;
      return scope.classGroupIds;
    }

    const acrossYears = await this.sameCourseAcrossYears(tx, orgId, classGroupId);
    if (scope.scopeAll) return acrossYears;
    const allowed = new Set(scope.classGroupIds);
    return acrossYears.filter((id) => allowed.has(id));
  }

  private async sameCourseAcrossYears(
    tx: Database,
    orgId: string,
    classGroupId: string,
  ): Promise<string[]> {
    const [selected] = await tx
      .select({ gradeId: classGroups.gradeId, name: classGroups.name })
      .from(classGroups)
      .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)))
      .limit(1);
    if (!selected) return [];

    const rows = await tx
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(
        and(
          eq(classGroups.orgId, orgId),
          eq(classGroups.gradeId, selected.gradeId),
          eq(classGroups.name, selected.name),
        ),
      );
    return rows.map((r) => r.id);
  }

  private async resolveMeta(
    tx: Database,
    query: ComparableTrajectoryQueryDto,
  ): Promise<{
    gradeName: string | null;
    subjectName: string | null;
    classGroupName: string | null;
  }> {
    const [grade] = await tx
      .select({ name: grades.name })
      .from(grades)
      .where(eq(grades.id, query.gradeId))
      .limit(1);
    const [subject] = await tx
      .select({ name: subjects.name })
      .from(subjects)
      .where(eq(subjects.id, query.subjectId))
      .limit(1);

    let classGroupName: string | null = null;
    if (query.classGroupId) {
      const [cg] = await tx
        .select({ name: classGroups.name })
        .from(classGroups)
        .where(eq(classGroups.id, query.classGroupId))
        .limit(1);
      classGroupName = cg?.name ?? null;
    }

    return {
      gradeName: grade?.name ?? null,
      subjectName: subject?.name ?? null,
      classGroupName,
    };
  }

  private emptyResponse(
    query: ComparableTrajectoryQueryDto,
    meta: { gradeName: string | null; subjectName: string | null; classGroupName: string | null },
    scope: 'org' | 'teacher',
    refs: ComparabilityInstrumentRef[],
  ): ComparableTrajectoryResponse {
    return {
      scope,
      axis: query.axis,
      gradeId: query.gradeId,
      gradeName: meta.gradeName,
      subjectId: query.subjectId,
      subjectName: meta.subjectName,
      instrumentType: query.instrumentType,
      applicationPeriod: query.axis === 'years' ? (query.applicationPeriod ?? null) : null,
      classGroupId: query.classGroupId ?? null,
      classGroupName: meta.classGroupName,
      bands: null,
      series: [],
      current: null,
      byClassGroup: [],
      baselines: { previousPeriod: null, previousYear: null },
      comparability: buildComparabilityMeta(refs),
    };
  }

  private requireOrgId(user: JwtPayload): string {
    if (user.orgId) return user.orgId;
    throw new ForbiddenException('Usuario sin organización asociada');
  }
}

function toBandView(band: PerformanceBandInput): PerformanceBandView {
  return { key: band.key, label: band.label, order: band.order, color: band.color ?? null };
}
