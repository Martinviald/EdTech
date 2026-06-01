import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  assessments,
  classGroups,
  instruments,
  skillResults,
  studentEnrollments,
  students,
  subjectClasses,
  subjects,
  taxonomyNodes,
  teacherAssignments,
} from '@soe/db';
import {
  RESULTS_VIEWER_ROLES,
  percentageToPerformanceLevel,
  userHasAnyRole,
  type HeatmapCell,
  type HeatmapQueryDto,
  type HeatmapResponse,
  type HeatmapRow,
  type HeatmapSubject,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

// Roles "administrativos" — ven todos los cursos de la org. Cualquier otro rol
// con acceso (teacher, homeroom_teacher) ve sólo los cursos donde tiene
// teacher_assignments activos. Idéntico a AnalyticsService / DashboardsService.
const ADMIN_LIKE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

type Scope = { scopeAll: boolean; classGroupIds: string[] };

/** Fila cruda de la agregación por (node, subject). */
type CellRow = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  subjectId: string;
  subjectName: string;
  avgPct: string | null;
  studentsAssessed: number;
};

/** Fila cruda de la agregación por nodo (overall sobre todas las asignaturas). */
type OverallRow = {
  nodeId: string;
  avgPct: string | null;
};

@Injectable()
export class HeatmapService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/heatmap  (H6.10)
  // Matriz habilidad (fila, taxonomy_node) × asignatura (columna, subject) de
  // % logro promedio (0..100) agregado desde skill_results sobre el scope.
  // ───────────────────────────────────────────────────────────────────────────

  async getHeatmap(
    user: JwtPayload,
    query: HeatmapQueryDto,
  ): Promise<HeatmapResponse> {
    const orgId = this.requireOrgId(user);
    const scope = await this.getAccessibleClassGroupIds(user, orgId);

    // Profesor sin cursos → no hay datos visibles.
    if (!scope.scopeAll && scope.classGroupIds.length === 0) {
      return { subjects: [], rows: [] };
    }

    // Set de alumnos visibles según scope + filtros de curso/grado/período
    // (null = toda la org sin restricción de alumno).
    const studentIds = await this.resolveScopedStudentIds(orgId, scope, query);
    if (studentIds !== null && studentIds.length === 0) {
      return { subjects: [], rows: [] };
    }

    const baseConditions = this.buildConditions(orgId, query, studentIds);

    // 1 query: celdas agregadas por (node, subject).
    const cellRows = await this.loadCellRows(baseConditions);
    if (cellRows.length === 0) {
      return { subjects: [], rows: [] };
    }

    // 1 query: overall por nodo (promedio del nodo sobre todas las asignaturas
    // visibles). Es el promedio real student-weighted, no el promedio de celdas.
    const overallRows = await this.loadOverallRows(baseConditions);

    return this.assembleResponse(cellRows, overallRows);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Queries
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Condiciones base compartidas por las dos agregaciones. Filtra por org (del
   * token), instrumentos no borrados, los filtros opcionales del query y — para
   * profesores — los alumnos de sus cursos. Sólo considera asignaturas con
   * subject_id (las columnas del heatmap son subjects).
   */
  private buildConditions(
    orgId: string,
    query: HeatmapQueryDto,
    studentIds: string[] | null,
  ): SQL[] {
    const conditions: SQL[] = [
      eq(assessments.orgId, orgId),
      isNull(instruments.deletedAt),
      isNull(students.deletedAt),
      // El heatmap es habilidad × asignatura: sólo evaluaciones con subject.
      sql`${instruments.subjectId} is not null`,
    ];

    if (query.assessmentId) conditions.push(eq(assessments.id, query.assessmentId));
    if (query.instrumentId) {
      conditions.push(eq(assessments.instrumentId, query.instrumentId));
    }
    if (query.instrumentType) {
      // `instruments.type` es un pgEnum; el DTO entrega string. Comparamos por
      // texto para no acoplar el contrato al enum de Drizzle.
      conditions.push(sql`${instruments.type}::text = ${query.instrumentType}`);
    }
    if (query.subjectId) conditions.push(eq(instruments.subjectId, query.subjectId));
    if (query.gradeId) conditions.push(eq(instruments.gradeId, query.gradeId));
    // `classGroupId` / `academicYearId` se resuelven sobre el conjunto de
    // alumnos (resolveScopedStudentIds), no como join a class_groups: un
    // assessment puede tocar varios cursos y joinear inflaría los promedios.

    if (studentIds !== null) {
      conditions.push(inArray(skillResults.studentId, studentIds));
    }

    return conditions;
  }

  /** UNA query: % logro promedio + alumnos distintos por (node, subject). */
  private async loadCellRows(conditions: SQL[]): Promise<CellRow[]> {
    return this.db
      .select({
        nodeId: skillResults.nodeId,
        nodeName: taxonomyNodes.name,
        nodeType: taxonomyNodes.type,
        nodeCode: taxonomyNodes.code,
        subjectId: subjects.id,
        subjectName: subjects.name,
        avgPct: sql<string | null>`avg(${skillResults.percentage}::numeric)`,
        studentsAssessed: sql<number>`count(distinct ${skillResults.studentId})::int`,
      })
      .from(skillResults)
      .innerJoin(assessments, eq(assessments.id, skillResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, skillResults.nodeId))
      .innerJoin(students, eq(students.id, skillResults.studentId))
      .where(and(...conditions))
      .groupBy(
        skillResults.nodeId,
        taxonomyNodes.name,
        taxonomyNodes.type,
        taxonomyNodes.code,
        subjects.id,
        subjects.name,
      );
  }

  /** UNA query: % logro promedio del nodo sobre todas las asignaturas visibles. */
  private async loadOverallRows(conditions: SQL[]): Promise<OverallRow[]> {
    return this.db
      .select({
        nodeId: skillResults.nodeId,
        avgPct: sql<string | null>`avg(${skillResults.percentage}::numeric)`,
      })
      .from(skillResults)
      .innerJoin(assessments, eq(assessments.id, skillResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
      .innerJoin(students, eq(students.id, skillResults.studentId))
      .where(and(...conditions))
      .groupBy(skillResults.nodeId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Ensamblado de la matriz (en memoria, sin queries por celda)
  // ───────────────────────────────────────────────────────────────────────────

  private assembleResponse(
    cellRows: CellRow[],
    overallRows: OverallRow[],
  ): HeatmapResponse {
    // Asignaturas (columnas), únicas y ordenadas por nombre.
    const subjectMap = new Map<string, HeatmapSubject>();
    for (const r of cellRows) {
      if (!subjectMap.has(r.subjectId)) {
        subjectMap.set(r.subjectId, {
          subjectId: r.subjectId,
          subjectName: r.subjectName,
        });
      }
    }
    const subjectList = Array.from(subjectMap.values()).sort((a, b) =>
      a.subjectName.localeCompare(b.subjectName, 'es'),
    );

    // Celdas indexadas por nodo → subject.
    type NodeAccumulator = {
      nodeId: string;
      nodeName: string;
      nodeType: string;
      nodeCode: string | null;
      cellsBySubject: Map<string, HeatmapCell>;
    };
    const nodeMap = new Map<string, NodeAccumulator>();
    for (const r of cellRows) {
      let node = nodeMap.get(r.nodeId);
      if (!node) {
        node = {
          nodeId: r.nodeId,
          nodeName: r.nodeName,
          nodeType: r.nodeType,
          nodeCode: r.nodeCode,
          cellsBySubject: new Map(),
        };
        nodeMap.set(r.nodeId, node);
      }
      const pct = r.avgPct == null ? null : Number(r.avgPct);
      node.cellsBySubject.set(r.subjectId, {
        subjectId: r.subjectId,
        averageAchievement: pct,
        performanceLevel:
          pct == null ? null : percentageToPerformanceLevel(pct / 100),
        studentsAssessed: Number(r.studentsAssessed ?? 0),
      });
    }

    const overallByNode = new Map<string, number | null>();
    for (const r of overallRows) {
      overallByNode.set(r.nodeId, r.avgPct == null ? null : Number(r.avgPct));
    }

    const rows: HeatmapRow[] = Array.from(nodeMap.values()).map((node) => {
      const cells: HeatmapCell[] = subjectList.map(
        (s) =>
          node.cellsBySubject.get(s.subjectId) ?? {
            subjectId: s.subjectId,
            averageAchievement: null,
            performanceLevel: null,
            studentsAssessed: 0,
          },
      );
      const overall = overallByNode.get(node.nodeId) ?? null;
      return {
        nodeId: node.nodeId,
        nodeName: node.nodeName,
        nodeType: node.nodeType,
        nodeCode: node.nodeCode,
        overallAchievement: overall,
        overallPerformanceLevel:
          overall == null ? null : percentageToPerformanceLevel(overall / 100),
        cells,
      };
    });

    // Orden por criticidad: overallAchievement ascendente (las más críticas
    // primero). Nodos sin datos (null) al final.
    rows.sort((a, b) => {
      if (a.overallAchievement == null && b.overallAchievement == null) {
        return a.nodeName.localeCompare(b.nodeName, 'es');
      }
      if (a.overallAchievement == null) return 1;
      if (b.overallAchievement == null) return -1;
      return a.overallAchievement - b.overallAchievement;
    });

    return { subjects: subjectList, rows };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scoping (replica AnalyticsService — NO se importa de otro módulo)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * `org_id` SIEMPRE del token. Un caller sin org (platform_admin sin
   * membership) no puede operar sobre una org concreta sin contexto.
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
    user: JwtPayload,
    orgId: string,
  ): Promise<Scope> {
    if (user.isPlatformAdmin) return { scopeAll: true, classGroupIds: [] };

    const adminLike = userHasAnyRole(user.roles, ADMIN_LIKE_ROLES);
    if (adminLike) return { scopeAll: true, classGroupIds: [] };

    if (!userHasAnyRole(user.roles, RESULTS_VIEWER_ROLES)) {
      return { scopeAll: false, classGroupIds: [] };
    }

    const rows = await this.db
      .select({ classGroupId: subjectClasses.classGroupId })
      .from(teacherAssignments)
      .innerJoin(
        subjectClasses,
        eq(subjectClasses.id, teacherAssignments.subjectClassId),
      )
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

  /**
   * Set de studentIds visibles dado el scope + los filtros de curso/período
   * (`classGroupId`, `academicYearId`). Retorna `null` cuando el caller ve toda
   * la org y no hay filtro que acote a un curso/período (sin restricción de
   * alumno). Retorna `[]` cuando el filtro deja el set vacío.
   */
  private async resolveScopedStudentIds(
    orgId: string,
    scope: Scope,
    query: HeatmapQueryDto,
  ): Promise<string[] | null> {
    const hasCourseFilter = !!query.classGroupId || !!query.academicYearId;

    if (scope.scopeAll && !hasCourseFilter) return null;

    // Conjunto de class_groups permitido por el scope.
    let allowedClassGroupIds: string[] | null;
    if (scope.scopeAll) {
      allowedClassGroupIds = null; // todos los de la org
    } else {
      if (scope.classGroupIds.length === 0) return [];
      allowedClassGroupIds = scope.classGroupIds;
      if (query.classGroupId) {
        if (!scope.classGroupIds.includes(query.classGroupId)) return [];
        allowedClassGroupIds = [query.classGroupId];
      }
    }

    const cgConditions = [eq(classGroups.orgId, orgId)];
    if (allowedClassGroupIds !== null) {
      cgConditions.push(inArray(classGroups.id, allowedClassGroupIds));
    }
    if (scope.scopeAll && query.classGroupId) {
      cgConditions.push(eq(classGroups.id, query.classGroupId));
    }
    if (query.academicYearId) {
      cgConditions.push(eq(classGroups.academicYearId, query.academicYearId));
    }

    const rows = await this.db
      .select({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(...cgConditions, eq(students.orgId, orgId), isNull(students.deletedAt)),
      );

    return Array.from(new Set(rows.map((r) => r.studentId)));
  }
}
