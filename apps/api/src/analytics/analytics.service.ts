import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  academicYears,
  assessmentCourseAssignments,
  assessments,
  classGroups,
  grades,
  gradingScales,
  instruments,
  skillResults,
  studentEnrollments,
  students,
  subjectClasses,
  subjects,
  taxonomyNodes,
  teacherAssignments,
  assessmentResults,
  withOrgContext,
} from '@soe/db';
import {
  RESULTS_VIEWER_ROLES,
  percentageToPerformanceLevel,
  userHasAnyRole,
  type GenerationalComparisonQueryDto,
  type GenerationalComparisonResponse,
  type GenerationalPoint,
  type PerformanceDistributionBucket,
  type PerformanceLevel,
  type ProgressionPoint,
  type ProgressionQueryDto,
  type ProgressionResponse,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

// Roles "administrativos" — ven todos los cursos de la org. Cualquier otro rol
// con acceso (teacher, homeroom_teacher) ve sólo los cursos donde tiene
// teacher_assignments activos. Idéntico a AssessmentResultsService.
const ADMIN_LIKE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

// Fallback de nota de aprobación (escala chilena 1.0-7.0) cuando ninguna
// evaluación del scope tiene grading scale asignada. El umbral real se resuelve
// desde grading_scales.passing_grade de la escala aplicable (ver
// resolveScopePassingGrade) — NO se hardcodea el supuesto de escala.
const DEFAULT_PASSING_GRADE = 4.0;

const PERFORMANCE_LEVELS_ORDER: readonly PerformanceLevel[] = [
  'insufficient',
  'elementary',
  'adequate',
  'advanced',
];

@Injectable()
export class AnalyticsService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/analytics/generational  (H6.3)
  // Compara el mismo grade entre años académicos. Agrupa por academic_years.year.
  // ───────────────────────────────────────────────────────────────────────────

  async generational(
    user: JwtPayload,
    query: GenerationalComparisonQueryDto,
  ): Promise<GenerationalComparisonResponse> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);

      const meta = await this.resolveGenerationalMeta(tx, orgId, query);

      // Profesor sin cursos → no hay datos visibles. Devolvemos serie vacía.
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return { ...meta, series: [] };
      }

      // Filtro base sobre class_groups: grade + org. El scope de profesor
      // restringe a sus class_groups asignados.
      const cgConditions = [
        eq(classGroups.gradeId, query.gradeId),
        eq(classGroups.orgId, orgId),
      ];
      if (!scope.scopeAll) {
        cgConditions.push(inArray(classGroups.id, scope.classGroupIds));
      }

      // Filtros opcionales sobre el instrumento de la evaluación.
      const instrumentConditions = this.instrumentFilters(query);

      if (query.nodeId) {
        const series = await this.generationalSeriesFromSkills(
          tx,
          orgId,
          cgConditions,
          instrumentConditions,
          query.nodeId,
        );
        return { ...meta, series };
      }

      const series = await this.generationalSeriesFromResults(
        tx,
        orgId,
        cgConditions,
        instrumentConditions,
      );
      return { ...meta, series };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/analytics/progression  (H6.6)
  // Serie temporal de % logro a través de las evaluaciones de un período.
  // ───────────────────────────────────────────────────────────────────────────

  async progression(
    user: JwtPayload,
    query: ProgressionQueryDto,
  ): Promise<ProgressionResponse> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);

      if (query.scope === 'student') {
        return this.progressionForStudent(tx, orgId, scope, query);
      }
      if (query.scope === 'class') {
        return this.progressionForClass(tx, orgId, scope, query);
      }
      return this.progressionForSkill(tx, orgId, scope, query);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Generational — helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * passing_grade de la grading scale aplicable al scope (la del instrumento de
   * la primera evaluación del scope que tenga escala asignada). Fallback 4.0 si
   * ninguna define escala. Evita hardcodear el supuesto de escala chilena.
   */
  private async resolveScopePassingGrade(
    tx: Database,
    orgId: string,
    cgConditions: SQL[],
    instrumentConditions: SQL[],
  ): Promise<number> {
    const [row] = await tx
      .select({ passingGrade: gradingScales.passingGrade })
      .from(assessments)
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(gradingScales, eq(gradingScales.id, instruments.gradingScaleId))
      .where(
        and(
          eq(assessments.orgId, orgId),
          isNull(instruments.deletedAt),
          ...cgConditions,
          ...instrumentConditions,
        ),
      )
      .limit(1);

    return row ? Number(row.passingGrade) : DEFAULT_PASSING_GRADE;
  }

  /**
   * Serie por año usando assessment_results.percentage / grade. Cada punto =
   * un academic_year con: nº de alumnos distintos, % logro promedio, % de
   * aprobación y distribución por nivel de desempeño.
   */
  private async generationalSeriesFromResults(
    tx: Database,
    orgId: string,
    cgConditions: SQL[],
    instrumentConditions: SQL[],
  ): Promise<GenerationalPoint[]> {
    const passingGrade = await this.resolveScopePassingGrade(
      tx,
      orgId,
      cgConditions,
      instrumentConditions,
    );

    const rows = await tx
      .select({
        academicYearId: academicYears.id,
        year: academicYears.year,
        avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
        studentsCount: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
        totalGraded: sql<number>`count(${assessmentResults.grade})::int`,
        passingCount: sql<number>`count(*) filter (where ${assessmentResults.grade}::numeric >= ${passingGrade})::int`,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(
        and(
          eq(assessments.orgId, orgId),
          isNull(students.deletedAt),
          isNull(instruments.deletedAt),
          ...cgConditions,
          ...instrumentConditions,
        ),
      )
      .groupBy(academicYears.id, academicYears.year)
      .orderBy(asc(academicYears.year));

    // La distribución por nivel se calcula con una query agregada aparte.
    const distByYear = await this.generationalDistributionFromResults(
      tx,
      orgId,
      cgConditions,
      instrumentConditions,
    );

    return rows.map((r) => {
      const avg = r.avgPct === null ? null : Number(r.avgPct);
      const passingRate =
        r.totalGraded > 0 ? (r.passingCount / r.totalGraded) * 100 : null;
      return {
        academicYearId: r.academicYearId,
        year: r.year,
        studentsCount: r.studentsCount,
        averageAchievement: avg,
        passingRate,
        performanceDistribution:
          distByYear.get(r.academicYearId) ?? this.emptyDistribution(),
      };
    });
  }

  /**
   * Distribución por nivel de desempeño por año (desde assessment_results),
   * agregada en SQL para evitar N+1.
   */
  private async generationalDistributionFromResults(
    tx: Database,
    orgId: string,
    cgConditions: SQL[],
    instrumentConditions: SQL[],
  ): Promise<Map<string, PerformanceDistributionBucket[]>> {
    const rows = await tx
      .select({
        academicYearId: academicYears.id,
        level: assessmentResults.performanceLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(
        and(
          eq(assessments.orgId, orgId),
          isNull(students.deletedAt),
          isNull(instruments.deletedAt),
          ...cgConditions,
          ...instrumentConditions,
        ),
      )
      .groupBy(academicYears.id, assessmentResults.performanceLevel);

    return this.buildDistributionMap(rows);
  }

  /**
   * Serie por año enfocada en una habilidad (nodeId), usando skill_results.
   */
  private async generationalSeriesFromSkills(
    tx: Database,
    orgId: string,
    cgConditions: SQL[],
    instrumentConditions: SQL[],
    nodeId: string,
  ): Promise<GenerationalPoint[]> {
    const rows = await tx
      .select({
        academicYearId: academicYears.id,
        year: academicYears.year,
        avgPct: sql<string | null>`avg(${skillResults.percentage}::numeric)`,
        studentsCount: sql<number>`count(distinct ${skillResults.studentId})::int`,
      })
      .from(skillResults)
      .innerJoin(assessments, eq(assessments.id, skillResults.assessmentId))
      .innerJoin(students, eq(students.id, skillResults.studentId))
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(
        and(
          eq(assessments.orgId, orgId),
          eq(skillResults.nodeId, nodeId),
          isNull(students.deletedAt),
          isNull(instruments.deletedAt),
          ...cgConditions,
          ...instrumentConditions,
        ),
      )
      .groupBy(academicYears.id, academicYears.year)
      .orderBy(asc(academicYears.year));

    const distRows = await tx
      .select({
        academicYearId: academicYears.id,
        level: skillResults.performanceLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(skillResults)
      .innerJoin(assessments, eq(assessments.id, skillResults.assessmentId))
      .innerJoin(students, eq(students.id, skillResults.studentId))
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(
        and(
          eq(assessments.orgId, orgId),
          eq(skillResults.nodeId, nodeId),
          isNull(students.deletedAt),
          isNull(instruments.deletedAt),
          ...cgConditions,
          ...instrumentConditions,
        ),
      )
      .groupBy(academicYears.id, skillResults.performanceLevel);

    const distByYear = this.buildDistributionMap(distRows);

    return rows.map((r) => {
      const avg = r.avgPct === null ? null : Number(r.avgPct);
      return {
        academicYearId: r.academicYearId,
        year: r.year,
        studentsCount: r.studentsCount,
        averageAchievement: avg,
        // passingRate no aplica a una habilidad puntual (no hay nota por skill).
        passingRate: null,
        performanceDistribution:
          distByYear.get(r.academicYearId) ?? this.emptyDistribution(),
      };
    });
  }

  /** Etiquetas del grade/subject/node para la respuesta. */
  private async resolveGenerationalMeta(
    tx: Database,
    orgId: string,
    query: GenerationalComparisonQueryDto,
  ): Promise<Omit<GenerationalComparisonResponse, 'series'>> {
    const [grade] = await tx
      .select({ name: grades.name })
      .from(grades)
      .where(eq(grades.id, query.gradeId))
      .limit(1);

    let subjectName: string | null = null;
    if (query.subjectId) {
      const [subject] = await tx
        .select({ name: subjects.name })
        .from(subjects)
        .where(eq(subjects.id, query.subjectId))
        .limit(1);
      subjectName = subject?.name ?? null;
    }

    let nodeName: string | null = null;
    if (query.nodeId) {
      const [node] = await tx
        .select({ name: taxonomyNodes.name })
        .from(taxonomyNodes)
        .where(eq(taxonomyNodes.id, query.nodeId))
        .limit(1);
      nodeName = node?.name ?? null;
    }

    return {
      gradeId: query.gradeId,
      gradeName: grade?.name ?? null,
      subjectId: query.subjectId ?? null,
      subjectName,
      nodeId: query.nodeId ?? null,
      nodeName,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Progression — helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async progressionForStudent(
    tx: Database,
    orgId: string,
    scope: { scopeAll: boolean; classGroupIds: string[] },
    query: ProgressionQueryDto,
  ): Promise<ProgressionResponse> {
    const studentId = query.studentId!;

    // Verificar que el alumno pertenece a la org y es visible para el caller.
    const visible = await this.isStudentVisible(tx, orgId, scope, studentId);
    if (!visible) {
      throw new ForbiddenException('Sin acceso a la progresión de este alumno');
    }

    const [student] = await tx
      .select({ firstName: students.firstName, lastName: students.lastName })
      .from(students)
      .where(and(eq(students.id, studentId), eq(students.orgId, orgId)))
      .limit(1);

    const rows = await tx
      .select({
        assessmentId: assessments.id,
        assessmentName: assessments.name,
        instrumentName: instruments.name,
        administeredAt: assessments.administeredAt,
        achievement: assessmentResults.percentage,
        performanceLevel: assessmentResults.performanceLevel,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(
        and(
          eq(assessmentResults.studentId, studentId),
          eq(assessments.orgId, orgId),
          isNull(instruments.deletedAt),
          ...this.instrumentFilters(query),
        ),
      )
      .orderBy(asc(assessments.administeredAt));

    return {
      scope: 'student',
      subjectId: query.subjectId ?? null,
      entityId: studentId,
      entityLabel: student
        ? `${student.firstName} ${student.lastName}`.trim()
        : null,
      points: rows.map((r) => this.toProgressionPoint(r)),
    };
  }

  private async progressionForClass(
    tx: Database,
    orgId: string,
    scope: { scopeAll: boolean; classGroupIds: string[] },
    query: ProgressionQueryDto,
  ): Promise<ProgressionResponse> {
    const classGroupId = query.classGroupId!;

    if (!scope.scopeAll && !scope.classGroupIds.includes(classGroupId)) {
      throw new ForbiddenException('Sin acceso a la progresión de este curso');
    }

    const [cg] = await tx
      .select({ name: classGroups.name })
      .from(classGroups)
      .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)))
      .limit(1);

    if (!cg) {
      return {
        scope: 'class',
        subjectId: query.subjectId ?? null,
        entityId: classGroupId,
        entityLabel: null,
        points: [],
      };
    }

    const rows = await tx
      .select({
        assessmentId: assessments.id,
        assessmentName: assessments.name,
        instrumentName: instruments.name,
        administeredAt: assessments.administeredAt,
        avgPct: sql<string | null>`avg(${assessmentResults.percentage}::numeric)`,
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(students, eq(students.id, assessmentResults.studentId))
      .innerJoin(
        studentEnrollments,
        eq(studentEnrollments.studentId, assessmentResults.studentId),
      )
      .where(
        and(
          eq(studentEnrollments.classGroupId, classGroupId),
          eq(assessments.orgId, orgId),
          isNull(students.deletedAt),
          isNull(instruments.deletedAt),
          ...this.instrumentFilters(query),
        ),
      )
      .groupBy(
        assessments.id,
        assessments.name,
        instruments.name,
        assessments.administeredAt,
      )
      .orderBy(asc(assessments.administeredAt));

    return {
      scope: 'class',
      subjectId: query.subjectId ?? null,
      entityId: classGroupId,
      entityLabel: cg.name,
      points: rows.map((r) =>
        this.toProgressionPointFromAvg(r, r.avgPct),
      ),
    };
  }

  private async progressionForSkill(
    tx: Database,
    orgId: string,
    scope: { scopeAll: boolean; classGroupIds: string[] },
    query: ProgressionQueryDto,
  ): Promise<ProgressionResponse> {
    const nodeId = query.nodeId!;

    const [node] = await tx
      .select({ name: taxonomyNodes.name })
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.id, nodeId))
      .limit(1);

    // Para profesor puro restringimos a alumnos de sus cursos.
    const studentFilter = await this.skillStudentFilter(tx, orgId, scope);
    if (studentFilter !== null && studentFilter.length === 0) {
      return {
        scope: 'skill',
        subjectId: query.subjectId ?? null,
        entityId: nodeId,
        entityLabel: node?.name ?? null,
        points: [],
      };
    }

    const conditions = [
      eq(skillResults.nodeId, nodeId),
      eq(assessments.orgId, orgId),
      isNull(students.deletedAt),
      isNull(instruments.deletedAt),
      ...this.instrumentFilters(query),
    ];
    if (studentFilter !== null) {
      conditions.push(inArray(skillResults.studentId, studentFilter));
    }

    const rows = await tx
      .select({
        assessmentId: assessments.id,
        assessmentName: assessments.name,
        instrumentName: instruments.name,
        administeredAt: assessments.administeredAt,
        avgPct: sql<string | null>`avg(${skillResults.percentage}::numeric)`,
      })
      .from(skillResults)
      .innerJoin(assessments, eq(assessments.id, skillResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(students, eq(students.id, skillResults.studentId))
      .where(and(...conditions))
      .groupBy(
        assessments.id,
        assessments.name,
        instruments.name,
        assessments.administeredAt,
      )
      .orderBy(asc(assessments.administeredAt));

    return {
      scope: 'skill',
      subjectId: query.subjectId ?? null,
      entityId: nodeId,
      entityLabel: node?.name ?? null,
      points: rows.map((r) => this.toProgressionPointFromAvg(r, r.avgPct)),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scoping & shared helpers (replican AssessmentResultsService)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * `org_id` SIEMPRE del token. Un caller sin org (platform_admin sin
   * membership) no puede operar analítica de una org concreta sin contexto.
   */
  private requireOrgId(user: JwtPayload): string {
    if (user.orgId) return user.orgId;
    throw new ForbiddenException('Usuario sin organización asociada');
  }

  /**
   * Decide el alcance del usuario:
   *  - `scopeAll = true`  → admin-like / platform_admin, ve toda la org.
   *  - `scopeAll = false` → teacher puro, ve sólo sus class_groups asignados.
   */
  private async getAccessibleClassGroupIds(
    tx: Database,
    user: JwtPayload,
    orgId: string,
  ): Promise<{ scopeAll: boolean; classGroupIds: string[] }> {
    if (user.isPlatformAdmin) return { scopeAll: true, classGroupIds: [] };

    const adminLike = userHasAnyRole(user.roles, ADMIN_LIKE_ROLES);
    if (adminLike) return { scopeAll: true, classGroupIds: [] };

    if (!userHasAnyRole(user.roles, RESULTS_VIEWER_ROLES)) {
      return { scopeAll: false, classGroupIds: [] };
    }

    const rows = await tx
      .select({ classGroupId: subjectClasses.classGroupId })
      .from(teacherAssignments)
      .innerJoin(subjectClasses, eq(subjectClasses.id, teacherAssignments.subjectClassId))
      .innerJoin(classGroups, eq(classGroups.id, subjectClasses.classGroupId))
      .where(
        and(
          eq(teacherAssignments.userId, user.userId),
          eq(classGroups.orgId, orgId),
        ),
      );

    const ids = Array.from(new Set(rows.map((r) => r.classGroupId)));
    return { scopeAll: false, classGroupIds: ids };
  }

  /** Set de studentIds visibles para un profesor, o `null` si ve toda la org. */
  private async skillStudentFilter(
    tx: Database,
    orgId: string,
    scope: { scopeAll: boolean; classGroupIds: string[] },
  ): Promise<string[] | null> {
    if (scope.scopeAll) return null;
    if (scope.classGroupIds.length === 0) return [];

    const rows = await tx
      .select({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          inArray(studentEnrollments.classGroupId, scope.classGroupIds),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      );
    return Array.from(new Set(rows.map((r) => r.studentId)));
  }

  /** Verifica que un alumno pertenezca a la org y al scope del caller. */
  private async isStudentVisible(
    tx: Database,
    orgId: string,
    scope: { scopeAll: boolean; classGroupIds: string[] },
    studentId: string,
  ): Promise<boolean> {
    const [student] = await tx
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.id, studentId),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      )
      .limit(1);
    if (!student) return false;
    if (scope.scopeAll) return true;
    if (scope.classGroupIds.length === 0) return false;

    const [enrollment] = await tx
      .select({ id: studentEnrollments.id })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.studentId, studentId),
          inArray(studentEnrollments.classGroupId, scope.classGroupIds),
        ),
      )
      .limit(1);
    return !!enrollment;
  }

  /** Filtros opcionales por subject/instrumentType del instrumento. */
  private instrumentFilters(query: {
    subjectId?: string;
    instrumentType?: string;
  }): SQL[] {
    const conds: SQL[] = [];
    if (query.subjectId) {
      conds.push(eq(instruments.subjectId, query.subjectId));
    }
    if (query.instrumentType) {
      // `instruments.type` es un pgEnum; el DTO entrega string. Comparamos por
      // texto para no acoplar el contrato al enum de Drizzle.
      conds.push(sql`${instruments.type}::text = ${query.instrumentType}`);
    }
    return conds;
  }

  private buildDistributionMap(
    rows: { academicYearId: string; level: PerformanceLevel | null; count: number }[],
  ): Map<string, PerformanceDistributionBucket[]> {
    const byYear = new Map<string, Map<PerformanceLevel, number>>();
    for (const r of rows) {
      if (!r.level) continue;
      const counts = byYear.get(r.academicYearId) ?? new Map();
      counts.set(r.level, (counts.get(r.level) ?? 0) + r.count);
      byYear.set(r.academicYearId, counts);
    }

    const result = new Map<string, PerformanceDistributionBucket[]>();
    for (const [yearId, counts] of byYear) {
      const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
      const buckets: PerformanceDistributionBucket[] = PERFORMANCE_LEVELS_ORDER.map(
        (level) => {
          const count = counts.get(level) ?? 0;
          return {
            level,
            count,
            percentage: total > 0 ? (count / total) * 100 : 0,
          };
        },
      );
      result.set(yearId, buckets);
    }
    return result;
  }

  private emptyDistribution(): PerformanceDistributionBucket[] {
    return PERFORMANCE_LEVELS_ORDER.map((level) => ({
      level,
      count: 0,
      percentage: 0,
    }));
  }

  private toProgressionPoint(r: {
    assessmentId: string;
    assessmentName: string | null;
    instrumentName: string;
    administeredAt: Date | null;
    achievement: string | null;
    performanceLevel: PerformanceLevel | null;
  }): ProgressionPoint {
    const achievement = r.achievement === null ? null : Number(r.achievement);
    return {
      assessmentId: r.assessmentId,
      assessmentName: r.assessmentName,
      instrumentName: r.instrumentName,
      administeredAt: r.administeredAt,
      achievement,
      performanceLevel: r.performanceLevel,
    };
  }

  private toProgressionPointFromAvg(
    r: {
      assessmentId: string;
      assessmentName: string | null;
      instrumentName: string;
      administeredAt: Date | null;
    },
    avgPct: string | null,
  ): ProgressionPoint {
    const achievement = avgPct === null ? null : Number(avgPct);
    return {
      assessmentId: r.assessmentId,
      assessmentName: r.assessmentName,
      instrumentName: r.instrumentName,
      administeredAt: r.administeredAt,
      achievement,
      // Nivel derivado del promedio (percentageToPerformanceLevel espera 0..1).
      performanceLevel:
        achievement === null
          ? null
          : percentageToPerformanceLevel(achievement / 100),
    };
  }
}
