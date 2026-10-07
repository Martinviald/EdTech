import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentItemStats,
  assessmentResults,
  assessments,
  instruments,
  itemTaxonomyTags,
  resolveEffectiveBandsForInstruments,
  studentEnrollments,
  students,
  taxonomyNodes,
  withOrgContext,
} from '@soe/db';
import {
  achievementPct,
  addTally,
  areInstrumentsComparable,
  emptyTally,
  tallyOf,
  type AchievementTally,
  type AssessmentComparisonBandCell,
  type AssessmentComparisonCandidate,
  type AssessmentComparisonCandidatesQueryDto,
  type AssessmentComparisonCandidatesResponse,
  type AssessmentComparisonCohort,
  type AssessmentComparisonMovement,
  type AssessmentComparisonNode,
  type AssessmentComparisonQueryDto,
  type AssessmentComparisonResponse,
  type AssessmentComparisonSide,
  type AssessmentComparisonTransition,
  type ComparabilityInstrumentRef,
  type InstrumentApplicationPeriod,
  type MetricType,
  type PerformanceBandInput,
  type PerformanceBandView,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import {
  resolveClassGroupScope,
  type ClassGroupScope,
} from '../common/helpers/class-group-scope.helper';
import { InjectDb, type Database } from '../database/database.types';
import { hydrateBandForStudent } from '../performance-bands/lib/hydrate-band-level';

type AssessmentMeta = {
  assessmentId: string;
  assessmentName: string | null;
  administeredAt: Date | null;
  instrumentId: string;
  instrumentName: string;
  type: typeof instruments.$inferSelect.type;
  subjectId: string | null;
  gradeId: string | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  year: number | null;
  trackId: string | null;
};

type StudentResult = {
  studentId: string;
  classGroupId: string;
  totalScore: string | null;
  maxScore: string | null;
  percentage: string | null;
  metricType: MetricType;
  performanceBandId: string | null;
};

type StudentResultRow = StudentResult & { assessmentId: string };

type CohortTally = { tally: AchievementTally; students: number };

type NodeAccumulator = {
  nodeId: string;
  nodeName: string;
  nodeType: string | null;
  tally: AchievementTally;
};

type SideAchievement = { achievementPct: number | null; achievementStudents: number };

type ResolvedBand = { key: string; rank: number };

@Injectable()
export class AssessmentComparisonsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async listCandidates(
    user: JwtPayload,
    query: AssessmentComparisonCandidatesQueryDto,
  ): Promise<AssessmentComparisonCandidatesResponse> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await resolveClassGroupScope(tx, user, orgId);
      const [base] = await this.loadAssessments(
        tx,
        orgId,
        eq(assessments.id, query.baseAssessmentId),
      );
      if (!base) throw this.notFound();

      const allowed = this.allowedClassGroups(scope, base.subjectId);
      const baseCourses = await this.loadCourseIds(tx, [base.assessmentId]);
      if (this.scopedCourses(baseCourses.get(base.assessmentId), allowed).length === 0) {
        throw this.notFound();
      }

      const baseRef = this.toComparabilityRef(base);
      const peers = (await this.loadAssessments(tx, orgId, this.peerCondition(base))).filter(
        (peer) => areInstrumentsComparable(baseRef, this.toComparabilityRef(peer)),
      );

      const counts = await this.countStudentsAssessed(
        tx,
        orgId,
        [base.assessmentId, ...peers.map((p) => p.assessmentId)],
        allowed,
      );

      const data = peers
        .filter((peer) => (counts.get(peer.assessmentId) ?? 0) > 0)
        .sort((a, b) => this.byAppliedAtDesc(a, b))
        .map((peer) => this.toCandidate(peer, counts.get(peer.assessmentId) ?? 0));

      return { base: this.toCandidate(base, counts.get(base.assessmentId) ?? 0), data };
    });
  }

  async compare(
    user: JwtPayload,
    query: AssessmentComparisonQueryDto,
  ): Promise<AssessmentComparisonResponse> {
    const orgId = this.requireOrgId(user);
    if (query.baseAssessmentId === query.comparisonAssessmentId) {
      throw new BadRequestException('Elige dos evaluaciones distintas para compararlas.');
    }

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await resolveClassGroupScope(tx, user, orgId);
      const ids = [query.baseAssessmentId, query.comparisonAssessmentId];
      const metas = new Map(
        (await this.loadAssessments(tx, orgId, inArray(assessments.id, ids))).map((m) => [
          m.assessmentId,
          m,
        ]),
      );
      const base = metas.get(query.baseAssessmentId);
      const comparison = metas.get(query.comparisonAssessmentId);
      if (!base || !comparison) throw this.notFound();

      if (
        !areInstrumentsComparable(
          this.toComparabilityRef(base),
          this.toComparabilityRef(comparison),
        )
      ) {
        throw new BadRequestException(
          'Las evaluaciones no son comparables: sus instrumentos deben ser del mismo tipo, grado, asignatura y línea de prueba.',
        );
      }

      const allowed = this.allowedClassGroups(scope, base.subjectId);
      const courses = await this.loadCourseIds(tx, ids);
      const scopedCourses = new Map<string, Set<string>>();
      for (const id of ids) {
        const scoped = this.scopedCourses(courses.get(id), allowed);
        if (scoped.length === 0) throw this.notFound();
        scopedCourses.set(id, new Set(scoped));
      }

      const results = await this.loadStudentResults(tx, orgId, ids, scopedCourses);
      const baseResults = results.get(base.assessmentId) ?? new Map<string, StudentResult>();
      const comparisonResults =
        results.get(comparison.assessmentId) ?? new Map<string, StudentResult>();

      const pairedIds: string[] = [];
      for (const studentId of baseResults.keys()) {
        if (comparisonResults.has(studentId)) pairedIds.push(studentId);
      }
      const fellBackToAll = query.cohort === 'paired' && pairedIds.length === 0;
      const cohort: AssessmentComparisonCohort = fellBackToAll ? 'all' : query.cohort;

      const effectiveBands = await resolveEffectiveBandsForInstruments(tx, [
        ...new Set([base.instrumentId, comparison.instrumentId]),
      ]);
      const baseBands = effectiveBands.get(base.instrumentId)?.bands ?? [];
      const comparisonBands = effectiveBands.get(comparison.instrumentId)?.bands ?? [];

      const cohortTallies =
        cohort === 'all' ? await this.loadCohortTallies(tx, ids, scopedCourses) : null;
      const nodes = await this.loadNodeComparison(
        tx,
        base.assessmentId,
        comparison.assessmentId,
        scopedCourses,
      );

      const baseBandByStudent = this.resolveStudentBands(baseResults, baseBands);
      const comparisonBandByStudent = this.resolveStudentBands(comparisonResults, comparisonBands);

      const baseCohortIds = cohort === 'paired' ? pairedIds : [...baseResults.keys()];
      const comparisonCohortIds = cohort === 'paired' ? pairedIds : [...comparisonResults.keys()];

      return {
        cohort,
        base: this.buildSide(
          base,
          baseResults,
          baseCohortIds,
          baseBands,
          baseBandByStudent,
          this.sideAchievement(cohort, cohortTallies, base.assessmentId, baseResults, pairedIds),
        ),
        comparison: this.buildSide(
          comparison,
          comparisonResults,
          comparisonCohortIds,
          comparisonBands,
          comparisonBandByStudent,
          this.sideAchievement(
            cohort,
            cohortTallies,
            comparison.assessmentId,
            comparisonResults,
            pairedIds,
          ),
        ),
        pairedStudents: pairedIds.length,
        fellBackToAll,
        transitions: this.buildTransitions(pairedIds, baseBandByStudent, comparisonBandByStudent),
        movement: this.buildMovement(
          pairedIds,
          baseBands,
          comparisonBands,
          baseBandByStudent,
          comparisonBandByStudent,
        ),
        nodes,
      };
    });
  }

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new ForbiddenException(
        'Sin organización activa. Selecciona una organización antes de continuar.',
      );
    }
    return user.orgId;
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Evaluación no encontrada o fuera de tu alcance.');
  }

  private allowedClassGroups(scope: ClassGroupScope, subjectId: string | null): Set<string> | null {
    if (scope.scopeAll) return null;
    const allowed = new Set(scope.homeroomClassGroupIds);
    if (subjectId) {
      for (const pair of scope.pairs) {
        if (pair.subjectId === subjectId) allowed.add(pair.classGroupId);
      }
    }
    return allowed;
  }

  private scopedCourses(courseIds: string[] | undefined, allowed: Set<string> | null): string[] {
    if (!courseIds) return [];
    return allowed === null ? courseIds : courseIds.filter((id) => allowed.has(id));
  }

  private peerCondition(base: AssessmentMeta): SQL {
    return and(
      ne(assessments.id, base.assessmentId),
      eq(instruments.type, base.type),
      base.gradeId ? eq(instruments.gradeId, base.gradeId) : isNull(instruments.gradeId),
      base.subjectId ? eq(instruments.subjectId, base.subjectId) : isNull(instruments.subjectId),
    ) as SQL;
  }

  private toComparabilityRef(meta: AssessmentMeta): ComparabilityInstrumentRef {
    return {
      instrumentId: meta.instrumentId,
      type: meta.type,
      subjectId: meta.subjectId,
      gradeId: meta.gradeId,
      applicationPeriod: meta.applicationPeriod,
      year: meta.year,
      trackId: meta.trackId,
    };
  }

  private byAppliedAtDesc(a: AssessmentMeta, b: AssessmentMeta): number {
    const aTime = a.administeredAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bTime = b.administeredAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (aTime === bTime) return 0;
    return bTime > aTime ? 1 : -1;
  }

  private toCandidate(
    meta: AssessmentMeta,
    studentsAssessed: number,
  ): AssessmentComparisonCandidate {
    return {
      assessmentId: meta.assessmentId,
      assessmentName: meta.assessmentName ?? meta.instrumentName,
      instrumentId: meta.instrumentId,
      instrumentName: meta.instrumentName,
      academicYear: meta.year,
      applicationPeriod: meta.applicationPeriod,
      appliedAt: meta.administeredAt ? meta.administeredAt.toISOString() : null,
      studentsAssessed,
    };
  }

  private async loadAssessments(
    tx: Database,
    orgId: string,
    condition: SQL,
  ): Promise<AssessmentMeta[]> {
    return tx
      .select({
        assessmentId: assessments.id,
        assessmentName: assessments.name,
        administeredAt: assessments.administeredAt,
        instrumentId: instruments.id,
        instrumentName: instruments.name,
        type: instruments.type,
        subjectId: instruments.subjectId,
        gradeId: instruments.gradeId,
        applicationPeriod: instruments.applicationPeriod,
        year: instruments.year,
        trackId: instruments.trackId,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(and(eq(assessments.orgId, orgId), condition));
  }

  private async loadCourseIds(
    tx: Database,
    assessmentIds: string[],
  ): Promise<Map<string, string[]>> {
    const rows = await tx
      .select({
        assessmentId: assessmentCourseAssignments.assessmentId,
        classGroupId: assessmentCourseAssignments.classGroupId,
      })
      .from(assessmentCourseAssignments)
      .where(inArray(assessmentCourseAssignments.assessmentId, assessmentIds));

    const byAssessment = new Map<string, string[]>();
    for (const row of rows) {
      const bucket = byAssessment.get(row.assessmentId);
      if (bucket) bucket.push(row.classGroupId);
      else byAssessment.set(row.assessmentId, [row.classGroupId]);
    }
    return byAssessment;
  }

  private async countStudentsAssessed(
    tx: Database,
    orgId: string,
    assessmentIds: string[],
    allowed: Set<string> | null,
  ): Promise<Map<string, number>> {
    if (allowed !== null && allowed.size === 0) return new Map();

    const rows = await tx
      .select({
        assessmentId: assessmentResults.assessmentId,
        students: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, assessmentResults.studentId))
      .innerJoin(
        assessmentCourseAssignments,
        and(
          eq(assessmentCourseAssignments.assessmentId, assessmentResults.assessmentId),
          eq(assessmentCourseAssignments.classGroupId, studentEnrollments.classGroupId),
        ),
      )
      .where(
        and(
          inArray(assessmentResults.assessmentId, assessmentIds),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
          allowed === null ? undefined : inArray(studentEnrollments.classGroupId, [...allowed]),
        ),
      )
      .groupBy(assessmentResults.assessmentId);

    return new Map(rows.map((row) => [row.assessmentId, Number(row.students)]));
  }

  private async loadStudentResults(
    tx: Database,
    orgId: string,
    assessmentIds: string[],
    scopedCourses: Map<string, Set<string>>,
  ): Promise<Map<string, Map<string, StudentResult>>> {
    const rows: StudentResultRow[] = await tx
      .select({
        assessmentId: assessmentResults.assessmentId,
        studentId: assessmentResults.studentId,
        classGroupId: studentEnrollments.classGroupId,
        totalScore: assessmentResults.totalScore,
        maxScore: assessmentResults.maxScore,
        percentage: assessmentResults.percentage,
        metricType: assessmentResults.metricType,
        performanceBandId: assessmentResults.performanceBandId,
      })
      .from(assessmentResults)
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, assessmentResults.studentId))
      .innerJoin(
        assessmentCourseAssignments,
        and(
          eq(assessmentCourseAssignments.assessmentId, assessmentResults.assessmentId),
          eq(assessmentCourseAssignments.classGroupId, studentEnrollments.classGroupId),
        ),
      )
      .where(
        and(
          inArray(assessmentResults.assessmentId, assessmentIds),
          inArray(studentEnrollments.classGroupId, this.unionOf(scopedCourses)),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      );

    const byAssessment = new Map<string, Map<string, StudentResult>>();
    for (const row of rows) {
      if (!scopedCourses.get(row.assessmentId)?.has(row.classGroupId)) continue;
      let bucket = byAssessment.get(row.assessmentId);
      if (!bucket) {
        bucket = new Map();
        byAssessment.set(row.assessmentId, bucket);
      }
      if (!bucket.has(row.studentId)) bucket.set(row.studentId, row);
    }
    return byAssessment;
  }

  private unionOf(scopedCourses: Map<string, Set<string>>): string[] {
    const union = new Set<string>();
    for (const courses of scopedCourses.values()) {
      for (const id of courses) union.add(id);
    }
    return [...union];
  }

  private async loadCohortTallies(
    tx: Database,
    assessmentIds: string[],
    scopedCourses: Map<string, Set<string>>,
  ): Promise<Map<string, CohortTally>> {
    const rows = await tx
      .select({
        assessmentId: assessmentItemStats.assessmentId,
        classGroupId: assessmentItemStats.classGroupId,
        scoreSum: sql<string | null>`sum(${assessmentItemStats.scoreSum}::numeric)`,
        maxSum: sql<string | null>`sum(${assessmentItemStats.maxSum}::numeric)`,
        students: sql<number>`max(${assessmentItemStats.studentCount})::int`,
      })
      .from(assessmentItemStats)
      .where(
        and(
          inArray(assessmentItemStats.assessmentId, assessmentIds),
          inArray(assessmentItemStats.classGroupId, this.unionOf(scopedCourses)),
        ),
      )
      .groupBy(assessmentItemStats.assessmentId, assessmentItemStats.classGroupId);

    const byAssessment = new Map<string, CohortTally>();
    for (const row of rows) {
      if (!scopedCourses.get(row.assessmentId)?.has(row.classGroupId)) continue;
      let acc = byAssessment.get(row.assessmentId);
      if (!acc) {
        acc = { tally: emptyTally(), students: 0 };
        byAssessment.set(row.assessmentId, acc);
      }
      addTally(acc.tally, tallyOf([row]));
      acc.students += Number(row.students ?? 0);
    }
    return byAssessment;
  }

  private async loadNodeComparison(
    tx: Database,
    baseAssessmentId: string,
    comparisonAssessmentId: string,
    scopedCourses: Map<string, Set<string>>,
  ): Promise<AssessmentComparisonNode[]> {
    const rows = await tx
      .select({
        assessmentId: assessmentItemStats.assessmentId,
        classGroupId: assessmentItemStats.classGroupId,
        nodeId: itemTaxonomyTags.nodeId,
        nodeName: taxonomyNodes.name,
        nodeType: sql<string | null>`${taxonomyNodes.type}::text`,
        scoreSum: sql<string | null>`sum(${assessmentItemStats.scoreSum}::numeric)`,
        maxSum: sql<string | null>`sum(${assessmentItemStats.maxSum}::numeric)`,
      })
      .from(assessmentItemStats)
      .innerJoin(itemTaxonomyTags, eq(itemTaxonomyTags.itemId, assessmentItemStats.itemId))
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, itemTaxonomyTags.nodeId))
      .where(
        and(
          inArray(assessmentItemStats.assessmentId, [baseAssessmentId, comparisonAssessmentId]),
          inArray(assessmentItemStats.classGroupId, this.unionOf(scopedCourses)),
        ),
      )
      .groupBy(
        assessmentItemStats.assessmentId,
        assessmentItemStats.classGroupId,
        itemTaxonomyTags.nodeId,
        taxonomyNodes.name,
        taxonomyNodes.type,
      );

    const baseNodes = new Map<string, NodeAccumulator>();
    const comparisonNodes = new Map<string, NodeAccumulator>();
    for (const row of rows) {
      if (!scopedCourses.get(row.assessmentId)?.has(row.classGroupId)) continue;
      const target = row.assessmentId === baseAssessmentId ? baseNodes : comparisonNodes;
      let acc = target.get(row.nodeId);
      if (!acc) {
        acc = {
          nodeId: row.nodeId,
          nodeName: row.nodeName,
          nodeType: row.nodeType,
          tally: emptyTally(),
        };
        target.set(row.nodeId, acc);
      }
      addTally(acc.tally, tallyOf([row]));
    }

    const nodes: AssessmentComparisonNode[] = [];
    for (const baseNode of baseNodes.values()) {
      const comparisonNode = comparisonNodes.get(baseNode.nodeId);
      if (!comparisonNode) continue;
      const basePct = achievementPct(baseNode.tally);
      const comparisonPct = achievementPct(comparisonNode.tally);
      nodes.push({
        nodeId: baseNode.nodeId,
        nodeName: baseNode.nodeName,
        nodeType: baseNode.nodeType,
        baseAchievementPct: basePct,
        comparisonAchievementPct: comparisonPct,
        deltaPp: basePct === null || comparisonPct === null ? null : comparisonPct - basePct,
      });
    }
    return nodes.sort(
      (a, b) =>
        (a.nodeType ?? '').localeCompare(b.nodeType ?? '') ||
        a.nodeName.localeCompare(b.nodeName, 'es'),
    );
  }

  private sideAchievement(
    cohort: AssessmentComparisonCohort,
    cohortTallies: Map<string, CohortTally> | null,
    assessmentId: string,
    results: Map<string, StudentResult>,
    pairedIds: string[],
  ): SideAchievement {
    if (cohort === 'all') {
      const cohortTally = cohortTallies?.get(assessmentId);
      if (!cohortTally) return { achievementPct: null, achievementStudents: 0 };
      const pct = achievementPct(cohortTally.tally);
      return { achievementPct: pct, achievementStudents: pct === null ? 0 : cohortTally.students };
    }

    const scored: StudentResult[] = [];
    for (const studentId of pairedIds) {
      const result = results.get(studentId);
      if (result && Number(result.maxScore ?? 0) > 0) scored.push(result);
    }
    const pct = achievementPct(
      tallyOf(scored.map((r) => ({ scoreSum: r.totalScore, maxSum: r.maxScore }))),
    );
    return { achievementPct: pct, achievementStudents: pct === null ? 0 : scored.length };
  }

  private resolveStudentBands(
    results: Map<string, StudentResult>,
    bands: PerformanceBandInput[],
  ): Map<string, ResolvedBand> {
    const resolved = new Map<string, ResolvedBand>();
    if (bands.length === 0) return resolved;
    const rankByKey = this.rankByKey(bands);

    for (const [studentId, result] of results) {
      const { band } = hydrateBandForStudent(
        {
          metricType: result.metricType,
          percentage: result.percentage === null ? null : Number(result.percentage),
          performanceLevel: null,
          performanceBandId: result.performanceBandId,
        },
        bands,
      );
      if (band) resolved.set(studentId, { key: band.key, rank: rankByKey.get(band.key) ?? 0 });
    }
    return resolved;
  }

  private rankByKey(bands: PerformanceBandInput[]): Map<string, number> {
    const sorted = [...bands].sort((a, b) => a.order - b.order);
    return new Map(sorted.map((band, index) => [band.key, index]));
  }

  private buildSide(
    meta: AssessmentMeta,
    results: Map<string, StudentResult>,
    cohortIds: string[],
    bands: PerformanceBandInput[],
    bandByStudent: Map<string, ResolvedBand>,
    achievement: SideAchievement,
  ): AssessmentComparisonSide {
    const sortedBands = [...bands].sort((a, b) => a.order - b.order);
    const counts = new Map<string, number>();
    let bandStudents = 0;
    for (const studentId of cohortIds) {
      const band = bandByStudent.get(studentId);
      if (!band) continue;
      counts.set(band.key, (counts.get(band.key) ?? 0) + 1);
      bandStudents += 1;
    }

    const bandDistribution: AssessmentComparisonBandCell[] = sortedBands.map((band) => {
      const count = counts.get(band.key) ?? 0;
      return {
        bandKey: band.key,
        count,
        percentage: bandStudents > 0 ? (count / bandStudents) * 100 : 0,
      };
    });

    return {
      ...this.toCandidate(meta, results.size),
      ...achievement,
      bands: sortedBands.map((band) => this.toBandView(band)),
      bandDistribution,
      bandStudents,
    };
  }

  private toBandView(band: PerformanceBandInput): PerformanceBandView {
    return {
      key: band.key,
      label: band.label,
      order: band.order,
      color: band.color ?? null,
      minThreshold: band.minThreshold,
      maxThreshold: band.maxThreshold,
      source: band.source,
    };
  }

  private buildTransitions(
    pairedIds: string[],
    baseBands: Map<string, ResolvedBand>,
    comparisonBands: Map<string, ResolvedBand>,
  ): AssessmentComparisonTransition[] {
    const cells = new Map<
      string,
      AssessmentComparisonTransition & { fromRank: number; toRank: number }
    >();
    for (const studentId of pairedIds) {
      const from = baseBands.get(studentId);
      const to = comparisonBands.get(studentId);
      if (!from || !to) continue;
      const key = `${from.key}\u0000${to.key}`;
      const cell = cells.get(key);
      if (cell) cell.count += 1;
      else
        cells.set(key, {
          fromBandKey: from.key,
          toBandKey: to.key,
          count: 1,
          fromRank: from.rank,
          toRank: to.rank,
        });
    }
    return [...cells.values()]
      .sort((a, b) => a.fromRank - b.fromRank || a.toRank - b.toRank)
      .map(({ fromBandKey, toBandKey, count }) => ({ fromBandKey, toBandKey, count }));
  }

  private buildMovement(
    pairedIds: string[],
    baseBandList: PerformanceBandInput[],
    comparisonBandList: PerformanceBandInput[],
    baseBands: Map<string, ResolvedBand>,
    comparisonBands: Map<string, ResolvedBand>,
  ): AssessmentComparisonMovement | null {
    if (baseBandList.length === 0 || baseBandList.length !== comparisonBandList.length) {
      return null;
    }
    const movement: AssessmentComparisonMovement = { improved: 0, same: 0, declined: 0 };
    for (const studentId of pairedIds) {
      const from = baseBands.get(studentId);
      const to = comparisonBands.get(studentId);
      if (!from || !to) continue;
      if (to.rank > from.rank) movement.improved += 1;
      else if (to.rank < from.rank) movement.declined += 1;
      else movement.same += 1;
    }
    return movement;
  }
}
