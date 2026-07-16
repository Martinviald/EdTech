import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  assessmentSkillStats,
  assessments,
  classGroups,
  gradingScales,
  instruments,
  subjectClasses,
  subjects,
  taxonomyNodes,
  teacherAssignments,
  withOrgContext,
} from '@soe/db';
import {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  RESULTS_VIEWER_ROLES,
  RESULT_HIDDEN_NODE_TYPES,
  percentageToPerformanceLevel,
  userHasAnyRole,
  type HeatmapCell,
  type HeatmapQueryDto,
  type HeatmapResponse,
  type HeatmapRow,
  type HeatmapSubject,
  type PerformanceThresholds,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import {
  COHORT_PCT_SUM,
  COHORT_PCT_WEIGHT,
  COHORT_STUDENTS_ASSESSED,
  addCohortRow,
  cohortAverage,
  type CohortAccumulator,
} from '../common/helpers/cohort-skill-stats.helper';
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

/**
 * Fila cruda del read-model agregada al grano (node, subject, class_group).
 *
 * El curso NO es una dimensión de la matriz, pero sí del `group by`: es lo que permite
 * ponderar el promedio por `studentCount` y contar alumnos sin duplicar entre
 * evaluaciones (ver `cohort-skill-stats.helper`).
 */
type CellRow = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
  subjectId: string;
  subjectName: string;
  pctSum: string | null;
  pctWeight: number;
  studentsAssessed: number;
};

@Injectable()
export class HeatmapService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/heatmap  (H6.10)
  // Matriz habilidad (fila, taxonomy_node) × asignatura (columna, subject) de
  // % logro promedio (0..100) sobre el scope.
  //
  // Lee el read-model de cohorte `assessment_skill_stats` (grano curso), no
  // `skill_results` (grano alumno): así una evaluación cargada desde un informe
  // oficial DIA —sin respuestas por alumno— entra por el mismo camino que una
  // calculada desde `responses` (plan §5 y Fase 5).
  //
  // Los números NO se mueven: el `percentage` de `source='computed'` es la media de
  // los porcentajes por alumno del curso (decisión §9.2), y acá se recombina
  // ponderado por `studentCount`, que es exactamente el `avg()` por alumno de antes.
  // ───────────────────────────────────────────────────────────────────────────

  async getHeatmap(user: JwtPayload, query: HeatmapQueryDto): Promise<HeatmapResponse> {
    const orgId = this.requireOrgId(user);

    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);

      // Profesor sin cursos → no hay datos visibles.
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return { subjects: [], rows: [] };
      }

      // Set de cursos visibles según scope + filtros de curso/período
      // (null = toda la org sin restricción).
      const classGroupIds = await this.resolveScopedClassGroupIds(tx, orgId, scope, query);
      if (classGroupIds !== null && classGroupIds.length === 0) {
        return { subjects: [], rows: [] };
      }

      const baseConditions = this.buildConditions(orgId, query, classGroupIds);

      // 1 query: celdas agregadas por (node, subject, class_group).
      const cellRows = await this.loadCellRows(tx, baseConditions);
      if (cellRows.length === 0) {
        return { subjects: [], rows: [] };
      }

      // BUG #8: los niveles de desempeño deben usar los thresholds de la escala
      // del instrumento, no los defaults fijos. Se resuelven una vez sobre el
      // scope y se pasan a percentageToPerformanceLevel en el ensamblado.
      const thresholds = await this.resolveThresholds(tx, baseConditions);

      // El overall por nodo ya NO necesita query propia: cada fila del read-model
      // pertenece a exactamente un (node, subject, class_group), así que sumar los
      // numeradores y denominadores de sus celdas da el mismo promedio
      // student-weighted que antes calculaba `loadOverallRows`.
      return this.assembleResponse(cellRows, thresholds);
    });
  }

  /**
   * Thresholds (0..1) de la escala aplicable al scope. Toma el `config.
   * performanceThresholds` del primer instrumento (con grading_scale) que matchee
   * las condiciones; si ninguno define escala/thresholds, usa los defaults DIA.
   * Corre dentro de `withOrgContext` (recibe `tx`): toca tablas con RLS
   * (assessment_skill_stats, assessments), y las condiciones ya incluyen
   * `eq(assessments.orgId, orgId)`.
   *
   * ⚠️ LIMITACIÓN (F1 OK / revisar en F2): asume escala HOMOGÉNEA en el scope.
   * Si la vista mezcla instrumentos con escalas de thresholds distintas (p. ej.
   * PAES + DIA), toma una sola escala (`limit(1)`) y la aplica a TODAS las celdas
   * → las de otra escala quedarían clasificadas con thresholds ajenos. En F1 (solo
   * DIA, thresholds = defaults) no afecta. El fix real (thresholds por instrumento)
   * se difiere a F2 multi-escala. El `orderBy(createdAt)` solo garantiza que la
   * escala elegida sea determinista, no que sea correcta para celdas de otra escala.
   */
  private async resolveThresholds(tx: Database, conditions: SQL[]): Promise<PerformanceThresholds> {
    const [row] = await tx
      .select({ config: gradingScales.config })
      .from(assessmentSkillStats)
      .innerJoin(assessments, eq(assessments.id, assessmentSkillStats.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
      .innerJoin(gradingScales, eq(gradingScales.id, instruments.gradingScaleId))
      .where(and(...conditions))
      // Determinista: el "primer instrumento" es el más antiguo del scope, no una
      // fila arbitraria (limit(1) sin orden no es determinista entre requests).
      .orderBy(asc(instruments.createdAt))
      .limit(1);

    const cfg = row?.config as
      | { performanceThresholds?: Partial<PerformanceThresholds> }
      | null
      | undefined;
    const t = cfg?.performanceThresholds;
    return {
      elementary: t?.elementary ?? DEFAULT_PERFORMANCE_THRESHOLDS.elementary,
      adequate: t?.adequate ?? DEFAULT_PERFORMANCE_THRESHOLDS.adequate,
      advanced: t?.advanced ?? DEFAULT_PERFORMANCE_THRESHOLDS.advanced,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Queries
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Condiciones base compartidas por la agregación y por `resolveThresholds`. Filtra
   * por org (del token), instrumentos no borrados, los filtros opcionales del query y
   * — para profesores — sus cursos. Sólo considera asignaturas con subject_id (las
   * columnas del heatmap son subjects).
   *
   * Ya no filtra `students.deleted_at`: el read-model excluye a los alumnos con soft
   * delete en el momento de calcularse (`loadEnrollmentByStudent` en @soe/db), no en
   * la lectura. La diferencia sólo se nota entre el borrado y el siguiente recálculo.
   */
  private buildConditions(
    orgId: string,
    query: HeatmapQueryDto,
    classGroupIds: string[] | null,
  ): SQL[] {
    const conditions: SQL[] = [
      eq(assessments.orgId, orgId),
      isNull(instruments.deletedAt),
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

    if (classGroupIds !== null) {
      conditions.push(inArray(assessmentSkillStats.classGroupId, classGroupIds));
    }

    return conditions;
  }

  /**
   * UNA query: numerador/denominador del promedio ponderado + alumnos evaluados,
   * agregados por (node, subject, class_group).
   */
  private async loadCellRows(tx: Database, conditions: SQL[]): Promise<CellRow[]> {
    return (
      tx
        .select({
          nodeId: assessmentSkillStats.nodeId,
          nodeName: taxonomyNodes.name,
          nodeType: taxonomyNodes.type,
          nodeCode: taxonomyNodes.code,
          subjectId: subjects.id,
          subjectName: subjects.name,
          pctSum: COHORT_PCT_SUM,
          pctWeight: COHORT_PCT_WEIGHT,
          studentsAssessed: COHORT_STUDENTS_ASSESSED,
        })
        .from(assessmentSkillStats)
        .innerJoin(assessments, eq(assessments.id, assessmentSkillStats.assessmentId))
        .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
        .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
        .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, assessmentSkillStats.nodeId))
        // TKT-05 — el heatmap (habilidad × asignatura) no reporta filas de descriptor.
        .where(and(...conditions, notInArray(taxonomyNodes.type, [...RESULT_HIDDEN_NODE_TYPES])))
        .groupBy(
          assessmentSkillStats.nodeId,
          taxonomyNodes.name,
          taxonomyNodes.type,
          taxonomyNodes.code,
          subjects.id,
          subjects.name,
          assessmentSkillStats.classGroupId,
        )
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Ensamblado de la matriz (en memoria, sin queries por celda)
  // ───────────────────────────────────────────────────────────────────────────

  private assembleResponse(
    cellRows: CellRow[],
    thresholds: PerformanceThresholds,
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

    // Acumuladores por nodo → subject, recombinando los cursos de cada celda. El
    // overall del nodo acumula TODAS sus filas (todas las asignaturas), que es el
    // mismo promedio student-weighted que antes daba la query `loadOverallRows`.
    type NodeAccumulator = {
      nodeId: string;
      nodeName: string;
      nodeType: string;
      nodeCode: string | null;
      cellsBySubject: Map<string, CohortAccumulator>;
      overall: CohortAccumulator;
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
          overall: { pctSum: 0, pctWeight: 0, studentsAssessed: 0 },
        };
        nodeMap.set(r.nodeId, node);
      }
      addCohortRow(node.cellsBySubject, r.subjectId, r);
      node.overall.pctSum += r.pctSum == null ? 0 : Number(r.pctSum);
      node.overall.pctWeight += Number(r.pctWeight ?? 0);
    }

    const toCell = (subjectId: string, acc: CohortAccumulator): HeatmapCell => {
      const pct = cohortAverage(acc);
      return {
        subjectId,
        averageAchievement: pct,
        performanceLevel:
          pct == null
            ? null
            : percentageToPerformanceLevel(pct / 100, { performanceThresholds: thresholds }),
        studentsAssessed: acc.studentsAssessed,
      };
    };

    const rows: HeatmapRow[] = Array.from(nodeMap.values()).map((node) => {
      const cells: HeatmapCell[] = subjectList.map((s) => {
        const acc = node.cellsBySubject.get(s.subjectId);
        return acc
          ? toCell(s.subjectId, acc)
          : {
              subjectId: s.subjectId,
              averageAchievement: null,
              performanceLevel: null,
              studentsAssessed: 0,
            };
      });
      const overall = cohortAverage(node.overall);
      return {
        nodeId: node.nodeId,
        nodeName: node.nodeName,
        nodeType: node.nodeType,
        nodeCode: node.nodeCode,
        overallAchievement: overall,
        overallPerformanceLevel:
          overall == null
            ? null
            : percentageToPerformanceLevel(overall / 100, {
                performanceThresholds: thresholds,
              }),
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
    tx: Database,
    user: JwtPayload,
    orgId: string,
  ): Promise<Scope> {
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
      .where(and(eq(teacherAssignments.userId, user.userId), eq(classGroups.orgId, orgId)));

    const ids = Array.from(new Set(rows.map((r) => r.classGroupId)));
    return { scopeAll: false, classGroupIds: ids };
  }

  /**
   * Set de class_groups visibles dado el scope + los filtros de curso/período
   * (`classGroupId`, `academicYearId`). Retorna `null` cuando el caller ve toda
   * la org y no hay filtro que acote (sin restricción). Retorna `[]` cuando el
   * filtro deja el set vacío.
   *
   * Antes esto resolvía alumnos (`resolveScopedStudentIds`) porque la agregación
   * era por alumno. El read-model tiene grano curso y el filtro de la UI siempre
   * nació de cursos, así que resolverlos directo es el mismo conjunto sin el rodeo
   * por `student_enrollments`.
   */
  private async resolveScopedClassGroupIds(
    tx: Database,
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

    const rows = await tx
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(and(...cgConditions));

    return Array.from(new Set(rows.map((r) => r.id)));
  }
}
