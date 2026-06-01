import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentResults,
  assessments,
  classGroups,
  grades,
  instruments,
  itemTaxonomyTags,
  items,
  responses,
  studentEnrollments,
  students,
  subjectClasses,
  subjects,
  taxonomyNodes,
  teacherAssignments,
} from '@soe/db';
import {
  RESULTS_VIEWER_ROLES,
  userHasAnyRole,
  type AlternativeDistribution,
  type AssessmentListQueryDto,
  type AssessmentListResponse,
  type AssessmentOption,
  type ItemMatrixQueryDto,
  type ItemMatrixResponse,
  type ItemTaxonomyRef,
  type MatrixCell,
  type MatrixQuestionColumn,
  type MatrixStudentRow,
  type QuestionAnalysisQueryDto,
  type QuestionAnalysisResponse,
  type QuestionTaxonomyTag,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

// Roles "administrativos" — ven todos los cursos de la org. Cualquier otro rol
// con acceso (teacher, homeroom_teacher) ve sólo los cursos donde tiene
// teacher_assignments activos. Idéntico a AssessmentResultsService/AnalyticsService.
const ADMIN_LIKE_ROLES: readonly UserRole[] = [
  'platform_admin',
  'school_admin',
  'academic_director',
  'cycle_director',
  'dept_head',
  'coordinator',
  'eval_coordinator',
];

// Tipos de taxonomy_node que cuentan como "contenido/OA" (vs habilidad). El
// resto (skill, domain, axis, …) se trata como habilidad. No se hardcodea
// ningún instrumento — todo se deriva por el `type` del nodo.
const CONTENT_NODE_TYPES: readonly string[] = ['content', 'learning_objective'];

type ScopeResult = { scopeAll: boolean; classGroupIds: string[] };

/** Forma mínima del contenido JSONB de un ítem de selección múltiple. */
interface ItemAlternative {
  key?: unknown;
  text?: unknown;
  isCorrect?: unknown;
}
interface ItemContent {
  stem?: unknown;
  imageUrl?: unknown;
  explanation?: unknown;
  alternatives?: unknown;
  correctKey?: unknown;
}

@Injectable()
export class ItemAnalysisService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/item-analysis/assessments  (selector de la tabla cruzada)
  // Evaluaciones con resultados visibles para el usuario, filtrables.
  // ───────────────────────────────────────────────────────────────────────────

  async listAssessments(
    user: JwtPayload,
    query: AssessmentListQueryDto,
  ): Promise<AssessmentListResponse> {
    const orgId = this.requireOrgId(user);
    const scope = await this.getAccessibleClassGroupIds(user, orgId);

    // Profesor sin cursos asignados → no ve evaluaciones.
    if (!scope.scopeAll && scope.classGroupIds.length === 0) {
      return { data: [] };
    }

    // Sólo evaluaciones con resultados (para que la matriz nunca salga vacía).
    const conditions = [
      eq(assessments.orgId, orgId),
      isNull(instruments.deletedAt),
      sql`exists (select 1 from ${assessmentResults} where ${assessmentResults.assessmentId} = ${assessments.id})`,
    ];
    if (query.subjectId) conditions.push(eq(instruments.subjectId, query.subjectId));
    if (query.instrumentType) {
      conditions.push(sql`${instruments.type}::text = ${query.instrumentType}`);
    }
    if (query.gradeId) conditions.push(eq(classGroups.gradeId, query.gradeId));
    if (query.classGroupId) {
      conditions.push(eq(assessmentCourseAssignments.classGroupId, query.classGroupId));
    }
    if (query.academicYearId) {
      conditions.push(eq(classGroups.academicYearId, query.academicYearId));
    }
    if (!scope.scopeAll) {
      conditions.push(
        inArray(assessmentCourseAssignments.classGroupId, scope.classGroupIds),
      );
    }

    // El join a course_assignments multiplica por curso; group by colapsa a una
    // fila por evaluación. gradeName representativo vía max() (una evaluación
    // suele apuntar a un grado).
    const rows = await this.db
      .select({
        assessmentId: assessments.id,
        name: assessments.name,
        administeredAt: assessments.administeredAt,
        instrumentName: instruments.name,
        instrumentType: sql<string>`${instruments.type}::text`,
        subjectName: subjects.name,
        gradeName: sql<string | null>`max(${grades.name})`,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .leftJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(and(...conditions))
      .groupBy(
        assessments.id,
        assessments.name,
        assessments.administeredAt,
        instruments.name,
        instruments.type,
        subjects.name,
      )
      .orderBy(desc(assessments.administeredAt));

    if (rows.length === 0) return { data: [] };

    // studentsCount por evaluación, acotado al scope del profesor (alumnos de sus
    // cursos). Para admins cuenta todos los alumnos con resultados.
    const ids = rows.map((r) => r.assessmentId);
    let scopedStudentIds: string[] | null = null;
    if (!scope.scopeAll) {
      const enr = await this.db
        .select({ studentId: studentEnrollments.studentId })
        .from(studentEnrollments)
        .where(inArray(studentEnrollments.classGroupId, scope.classGroupIds));
      scopedStudentIds = Array.from(new Set(enr.map((r) => r.studentId)));
    }

    const countConds = [inArray(assessmentResults.assessmentId, ids)];
    if (scopedStudentIds !== null) {
      countConds.push(inArray(assessmentResults.studentId, scopedStudentIds));
    }
    const countRows = await this.db
      .select({
        assessmentId: assessmentResults.assessmentId,
        count: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
      })
      .from(assessmentResults)
      .where(and(...countConds))
      .groupBy(assessmentResults.assessmentId);
    const countByAssessment = new Map(
      countRows.map((r) => [r.assessmentId, Number(r.count)]),
    );

    const data: AssessmentOption[] = rows.map((r) => ({
      assessmentId: r.assessmentId,
      name: r.name,
      instrumentName: r.instrumentName,
      instrumentType: r.instrumentType,
      subjectName: r.subjectName ?? null,
      gradeName: r.gradeName ?? null,
      administeredAt: r.administeredAt,
      studentsCount: countByAssessment.get(r.assessmentId) ?? 0,
    }));

    return { data };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // H6.11 — GET /api/item-analysis/matrix
  // ───────────────────────────────────────────────────────────────────────────

  async getMatrix(
    user: JwtPayload,
    query: ItemMatrixQueryDto,
  ): Promise<ItemMatrixResponse> {
    const orgId = this.requireOrgId(user);
    const assessment = await this.requireAssessmentOwnedByUser(
      user,
      orgId,
      query.assessmentId,
    );
    const scope = await this.getAccessibleClassGroupIds(user, orgId);

    // Profesor sin scope sobre esta evaluación → Forbidden.
    if (!scope.scopeAll) {
      const hasScope = await this.assessmentTouchesScope(
        query.assessmentId,
        scope.classGroupIds,
      );
      if (!hasScope) {
        throw new ForbiddenException(
          'No tiene acceso a los resultados de esta evaluación',
        );
      }
    }

    // Si pasa classGroupId, validar que está en el scope y pertenece a la org.
    if (query.classGroupId) {
      const ok = await this.classGroupInScope(orgId, scope, query.classGroupId);
      if (!ok) {
        throw new ForbiddenException('No tiene acceso a ese curso');
      }
    }

    // ── Columnas: ítems del instrumento de la evaluación ──────────────────────
    const questions = await this.loadQuestionColumns(
      assessment.instrumentId,
      query.nodeId,
    );
    const itemIds = questions.map((q) => q.itemId);

    // Empaquetar tasa de acierto por ítem (1 query agregada group by item_id) y
    // adjuntarla a las columnas.
    const studentFilter = await this.resolveAccessibleStudentIds(
      orgId,
      scope,
      query.classGroupId,
    );

    const questionsWithRate = await this.attachCorrectRates(
      query.assessmentId,
      questions,
      itemIds,
      studentFilter,
    );

    // ── Alumnos visibles con respuestas en la evaluación (paginados) ──────────
    const pagination = await this.loadStudentsPage(
      query.assessmentId,
      orgId,
      studentFilter,
      query.page,
      query.limit,
    );

    const pageStudentIds = pagination.data.map((s) => s.studentId);

    // ── Respuestas de la página de alumnos (1 query, inArray) → celdas ────────
    const cellsByStudent = await this.loadCells(
      query.assessmentId,
      pageStudentIds,
      itemIds,
    );

    const students: MatrixStudentRow[] = pagination.data.map((s) => {
      const byItem = cellsByStudent.get(s.studentId) ?? new Map<string, MatrixCell>();
      let correctCount = 0;
      let answeredCount = 0;
      const cells: MatrixCell[] = itemIds.map((itemId) => {
        const cell = byItem.get(itemId);
        if (!cell) {
          return { itemId, selectedKey: null, isCorrect: null, score: null };
        }
        if (cell.selectedKey !== null) answeredCount++;
        if (cell.isCorrect === true) correctCount++;
        return cell;
      });

      // % logro: de assessment_results.percentage si existe, si no derivado.
      let achievement: number | null = s.percentage != null ? Number(s.percentage) : null;
      if (achievement === null && answeredCount > 0) {
        achievement = (correctCount / answeredCount) * 100;
      }

      return {
        studentId: s.studentId,
        studentRut: s.studentRut,
        studentFullName: `${s.firstName} ${s.lastName}`.trim(),
        classGroupId: s.classGroupId,
        classGroupName: s.classGroupName,
        correctCount,
        answeredCount,
        achievement,
        cells,
      };
    });

    return {
      assessmentId: query.assessmentId,
      assessmentName: assessment.name,
      instrumentName: assessment.instrumentName,
      questions: questionsWithRate,
      students: {
        data: students,
        total: pagination.total,
        page: query.page,
        limit: query.limit,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // H6.12 — GET /api/item-analysis/questions/:itemId
  // ───────────────────────────────────────────────────────────────────────────

  async getQuestionAnalysis(
    user: JwtPayload,
    itemId: string,
    query: QuestionAnalysisQueryDto,
  ): Promise<QuestionAnalysisResponse> {
    const orgId = this.requireOrgId(user);
    const scope = await this.getAccessibleClassGroupIds(user, orgId);

    // El ítem debe pertenecer a un instrumento de la org del caller.
    const item = await this.requireItemVisible(user, orgId, itemId);

    // Si viene assessmentId, validar pertenencia a la org + scope del profesor.
    if (query.assessmentId) {
      const assessment = await this.requireAssessmentOwnedByUser(
        user,
        orgId,
        query.assessmentId,
      );
      // El ítem debe pertenecer al instrumento de la evaluación.
      if (assessment.instrumentId !== item.instrumentId) {
        throw new NotFoundException('Pregunta no encontrada en esta evaluación');
      }
      if (!scope.scopeAll) {
        const hasScope = await this.assessmentTouchesScope(
          query.assessmentId,
          scope.classGroupIds,
        );
        if (!hasScope) {
          throw new ForbiddenException(
            'No tiene acceso a los resultados de esta evaluación',
          );
        }
      }
    }

    if (query.classGroupId) {
      const ok = await this.classGroupInScope(orgId, scope, query.classGroupId);
      if (!ok) {
        throw new ForbiddenException('No tiene acceso a ese curso');
      }
    }

    const studentFilter = await this.resolveAccessibleStudentIds(
      orgId,
      scope,
      query.classGroupId,
    );

    const content = (item.content ?? {}) as ItemContent;
    const correctKey = this.deriveCorrectKey(content);
    const altDefs = this.parseAlternatives(content);

    const { skill, contentRef } = await this.loadItemTags(itemId);
    const tags = await this.loadAllItemTags(itemId);

    // ── Distribución agregada por valor de respuesta (1 query group by) ───────
    const dist = await this.loadAnswerDistribution(
      itemId,
      query.assessmentId,
      studentFilter,
    );

    let totalResponses = 0;
    let blankCount = 0;
    let correctCount = 0;
    const countByKey = new Map<string, number>();
    for (const row of dist) {
      totalResponses += row.count;
      if (row.answer === null) {
        blankCount += row.count;
      } else {
        countByKey.set(row.answer, (countByKey.get(row.answer) ?? 0) + row.count);
      }
      if (row.isCorrect) correctCount += row.count;
    }

    const correctRate =
      totalResponses > 0 ? (correctCount / totalResponses) * 100 : null;

    const alternatives: AlternativeDistribution[] = altDefs.map((alt) => {
      const count = countByKey.get(alt.key) ?? 0;
      return {
        key: alt.key,
        text: alt.text,
        isCorrect: correctKey != null ? alt.key === correctKey : alt.isCorrect,
        count,
        percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0,
      };
    });

    return {
      itemId,
      position: item.position,
      type: item.type,
      stem: typeof content.stem === 'string' ? content.stem : null,
      imageUrl: typeof content.imageUrl === 'string' ? content.imageUrl : null,
      explanation:
        typeof content.explanation === 'string' ? content.explanation : null,
      correctKey,
      skill,
      content: contentRef,
      tags,
      totalResponses,
      blankCount,
      correctCount,
      correctRate,
      alternatives,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Query helpers (sin N+1)
  // ───────────────────────────────────────────────────────────────────────────

  /** Columnas de la matriz: ítems del instrumento, opcionalmente filtrados por nodeId. */
  private async loadQuestionColumns(
    instrumentId: string,
    nodeId: string | undefined,
  ): Promise<MatrixQuestionColumn[]> {
    const conditions = [
      eq(items.instrumentId, instrumentId),
      isNull(items.deletedAt),
    ];

    const rows = await this.db
      .select({
        itemId: items.id,
        position: items.position,
        type: sql<string>`${items.type}::text`,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .where(and(...conditions))
      .orderBy(asc(items.position));

    // Tags de todos los ítems (1 query) para derivar skill/content por ítem.
    const itemIds = rows.map((r) => r.itemId);
    const tagsByItem = await this.loadTagsByItems(itemIds);

    let columns: MatrixQuestionColumn[] = rows.map((r) => {
      const content = (r.content ?? {}) as ItemContent;
      const refs = tagsByItem.get(r.itemId) ?? { skill: null, contentRef: null };
      const maxScore =
        r.scoringConfig && typeof r.scoringConfig.points === 'number'
          ? r.scoringConfig.points
          : 1;
      return {
        itemId: r.itemId,
        position: r.position,
        type: r.type,
        maxScore,
        correctKey: this.deriveCorrectKey(content),
        skill: refs.skill,
        content: refs.contentRef,
        correctRate: null,
      };
    });

    // Filtro por nodeId: limita las columnas a ítems taggeados con ese nodo.
    if (nodeId) {
      const taggedItemIds = new Set<string>();
      for (const [iid, refs] of tagsByItem.entries()) {
        if (refs.skill?.nodeId === nodeId || refs.contentRef?.nodeId === nodeId) {
          taggedItemIds.add(iid);
        }
      }
      // tagsByItem sólo guarda primary/secondary representativos; consultar el
      // set completo de tags para el filtro exacto.
      const allTagged = await this.db
        .select({ itemId: itemTaxonomyTags.itemId })
        .from(itemTaxonomyTags)
        .where(
          and(
            inArray(itemTaxonomyTags.itemId, columns.map((c) => c.itemId)),
            eq(itemTaxonomyTags.nodeId, nodeId),
          ),
        );
      for (const t of allTagged) taggedItemIds.add(t.itemId);
      columns = columns.filter((c) => taggedItemIds.has(c.itemId));
    }

    return columns;
  }

  /** Tasa de acierto por ítem (1 query agregada group by item_id). */
  private async attachCorrectRates(
    assessmentId: string,
    questions: MatrixQuestionColumn[],
    itemIds: string[],
    studentFilter: string[] | null,
  ): Promise<MatrixQuestionColumn[]> {
    if (itemIds.length === 0) return questions;
    if (studentFilter !== null && studentFilter.length === 0) {
      return questions.map((q) => ({ ...q, correctRate: null }));
    }

    const conditions = [
      eq(responses.assessmentId, assessmentId),
      inArray(responses.itemId, itemIds),
    ];
    if (studentFilter !== null) {
      conditions.push(inArray(responses.studentId, studentFilter));
    }

    const rows = await this.db
      .select({
        itemId: responses.itemId,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`sum(case when ${responses.isCorrect} = true then 1 else 0 end)::int`,
      })
      .from(responses)
      .where(and(...conditions))
      .groupBy(responses.itemId);

    const rateByItem = new Map<string, number>();
    for (const r of rows) {
      const total = Number(r.total);
      const correct = Number(r.correct);
      rateByItem.set(r.itemId, total > 0 ? (correct / total) * 100 : 0);
    }

    return questions.map((q) => ({
      ...q,
      correctRate: rateByItem.has(q.itemId) ? rateByItem.get(q.itemId)! : null,
    }));
  }

  /** Alumnos con respuestas en la evaluación dentro del scope, paginados. */
  private async loadStudentsPage(
    assessmentId: string,
    orgId: string,
    studentFilter: string[] | null,
    page: number,
    limit: number,
  ): Promise<{
    data: {
      studentId: string;
      studentRut: string;
      firstName: string;
      lastName: string;
      classGroupId: string | null;
      classGroupName: string | null;
      percentage: string | null;
    }[];
    total: number;
  }> {
    if (studentFilter !== null && studentFilter.length === 0) {
      return { data: [], total: 0 };
    }

    const baseConditions = [
      eq(responses.assessmentId, assessmentId),
      eq(students.orgId, orgId),
      isNull(students.deletedAt),
    ];
    if (studentFilter !== null) {
      baseConditions.push(inArray(responses.studentId, studentFilter));
    }

    // Total de alumnos distintos con respuestas (1 query).
    const [countRow] = await this.db
      .select({
        total: sql<number>`count(distinct ${responses.studentId})::int`,
      })
      .from(responses)
      .innerJoin(students, eq(students.id, responses.studentId))
      .where(and(...baseConditions));
    const total = Number(countRow?.total ?? 0);

    if (total === 0) return { data: [], total: 0 };

    // Página de alumnos (1 query). NO se une enrollment/classGroup aquí: un alumno
    // con matrícula en varios años académicos generaría filas duplicadas y
    // descuadraría la paginación contra `total = count(distinct studentId)`. El %
    // logro viene de assessment_results (único por (assessment, alumno)).
    const rows = await this.db
      .select({
        studentId: students.id,
        studentRut: students.rut,
        firstName: students.firstName,
        lastName: students.lastName,
        percentage: assessmentResults.percentage,
      })
      .from(responses)
      .innerJoin(students, eq(students.id, responses.studentId))
      .leftJoin(
        assessmentResults,
        and(
          eq(assessmentResults.studentId, students.id),
          eq(assessmentResults.assessmentId, assessmentId),
        ),
      )
      .where(and(...baseConditions))
      .groupBy(
        students.id,
        students.rut,
        students.firstName,
        students.lastName,
        assessmentResults.percentage,
      )
      .orderBy(asc(students.lastName), asc(students.firstName))
      .limit(limit)
      .offset((page - 1) * limit);

    // Curso de cada alumno relevante a ESTA evaluación (1 query), resuelto aparte
    // para no inflar la página. Un alumno → un único curso (DISTINCT ON).
    const classGroupByStudent = await this.loadStudentClassGroups(
      assessmentId,
      rows.map((r) => r.studentId),
    );

    const data = rows.map((r) => {
      const cg = classGroupByStudent.get(r.studentId);
      return {
        studentId: r.studentId,
        studentRut: r.studentRut,
        firstName: r.firstName,
        lastName: r.lastName,
        classGroupId: cg?.id ?? null,
        classGroupName: cg?.name ?? null,
        percentage: r.percentage,
      };
    });

    return { data, total };
  }

  /**
   * Curso de cada alumno relevante a la evaluación (el class_group asignado a la
   * evaluación en el que el alumno está matriculado). Un alumno → un único curso
   * vía DISTINCT ON, evitando duplicados por matrículas en varios años.
   */
  private async loadStudentClassGroups(
    assessmentId: string,
    studentIds: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const result = new Map<string, { id: string; name: string }>();
    if (studentIds.length === 0) return result;

    const rows = await this.db
      .select({
        studentId: studentEnrollments.studentId,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
      })
      .from(studentEnrollments)
      .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
      .innerJoin(
        assessmentCourseAssignments,
        and(
          eq(assessmentCourseAssignments.classGroupId, classGroups.id),
          eq(assessmentCourseAssignments.assessmentId, assessmentId),
        ),
      )
      .where(inArray(studentEnrollments.studentId, studentIds))
      .orderBy(asc(studentEnrollments.studentId), asc(classGroups.name));

    // Un alumno → un único curso: nos quedamos con el primero (orden estable por
    // nombre de curso). Dedupe en JS para no depender de DISTINCT ON.
    for (const row of rows) {
      if (!result.has(row.studentId)) {
        result.set(row.studentId, { id: row.classGroupId, name: row.classGroupName });
      }
    }
    return result;
  }

  /** Respuestas de la página de alumnos (1 query) → mapa studentId → itemId → celda. */
  private async loadCells(
    assessmentId: string,
    studentIds: string[],
    itemIds: string[],
  ): Promise<Map<string, Map<string, MatrixCell>>> {
    const result = new Map<string, Map<string, MatrixCell>>();
    if (studentIds.length === 0 || itemIds.length === 0) return result;

    const rows = await this.db
      .select({
        studentId: responses.studentId,
        itemId: responses.itemId,
        value: responses.value,
        isCorrect: responses.isCorrect,
        finalScore: responses.finalScore,
        rawScore: responses.rawScore,
      })
      .from(responses)
      .where(
        and(
          eq(responses.assessmentId, assessmentId),
          inArray(responses.studentId, studentIds),
          inArray(responses.itemId, itemIds),
        ),
      );

    for (const r of rows) {
      const score =
        r.finalScore != null
          ? Number(r.finalScore)
          : r.rawScore != null
            ? Number(r.rawScore)
            : null;
      const cell: MatrixCell = {
        itemId: r.itemId,
        selectedKey: this.extractRawAnswer(r.value),
        isCorrect: r.isCorrect,
        score,
      };
      let byItem = result.get(r.studentId);
      if (!byItem) {
        byItem = new Map<string, MatrixCell>();
        result.set(r.studentId, byItem);
      }
      byItem.set(r.itemId, cell);
    }
    return result;
  }

  /** Distribución agregada de respuestas por valor de alternativa (1 query group by). */
  private async loadAnswerDistribution(
    itemId: string,
    assessmentId: string | undefined,
    studentFilter: string[] | null,
  ): Promise<{ answer: string | null; isCorrect: boolean; count: number }[]> {
    if (studentFilter !== null && studentFilter.length === 0) return [];

    const conditions = [eq(responses.itemId, itemId)];
    if (assessmentId) {
      conditions.push(eq(responses.assessmentId, assessmentId));
    }
    if (studentFilter !== null) {
      conditions.push(inArray(responses.studentId, studentFilter));
    }

    // coalesce de las claves candidatas raw | key | answer del JSONB. Mismo
    // orden de precedencia que extractRawAnswer (celdas de la matriz) para que la
    // distribución y las celdas reporten la misma alternativa.
    const answerExpr = sql<
      string | null
    >`nullif(coalesce(${responses.value}->>'raw', ${responses.value}->>'key', ${responses.value}->>'answer'), '')`;

    const rows = await this.db
      .select({
        answer: answerExpr,
        isCorrect: sql<boolean>`coalesce(${responses.isCorrect}, false)`,
        count: sql<number>`count(*)::int`,
      })
      .from(responses)
      .where(and(...conditions))
      .groupBy(answerExpr, responses.isCorrect);

    return rows.map((r) => ({
      answer: r.answer === null || r.answer === '' ? null : r.answer,
      isCorrect: r.isCorrect === true,
      count: Number(r.count),
    }));
  }

  /**
   * Tags representativos por ítem (1 query). skill = primer tag cuyo nodo NO es
   * de contenido/OA (preferencia primary); content = primer tag cuyo nodo es de
   * contenido/OA.
   */
  private async loadTagsByItems(
    itemIds: string[],
  ): Promise<
    Map<string, { skill: ItemTaxonomyRef | null; contentRef: ItemTaxonomyRef | null }>
  > {
    const map = new Map<
      string,
      { skill: ItemTaxonomyRef | null; contentRef: ItemTaxonomyRef | null }
    >();
    if (itemIds.length === 0) return map;

    const rows = await this.db
      .select({
        itemId: itemTaxonomyTags.itemId,
        tagType: sql<string>`${itemTaxonomyTags.tagType}::text`,
        nodeId: taxonomyNodes.id,
        nodeName: taxonomyNodes.name,
        nodeType: sql<string>`${taxonomyNodes.type}::text`,
      })
      .from(itemTaxonomyTags)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, itemTaxonomyTags.nodeId))
      .where(inArray(itemTaxonomyTags.itemId, itemIds))
      .orderBy(asc(itemTaxonomyTags.tagType));

    for (const r of rows) {
      let entry = map.get(r.itemId);
      if (!entry) {
        entry = { skill: null, contentRef: null };
        map.set(r.itemId, entry);
      }
      const ref: ItemTaxonomyRef = {
        nodeId: r.nodeId,
        nodeName: r.nodeName,
        nodeType: r.nodeType,
      };
      if (CONTENT_NODE_TYPES.includes(r.nodeType)) {
        if (!entry.contentRef) entry.contentRef = ref;
      } else {
        if (!entry.skill) entry.skill = ref;
      }
    }
    return map;
  }

  /** skill/content de un único ítem (reusa loadTagsByItems). */
  private async loadItemTags(
    itemId: string,
  ): Promise<{ skill: ItemTaxonomyRef | null; contentRef: ItemTaxonomyRef | null }> {
    const map = await this.loadTagsByItems([itemId]);
    return map.get(itemId) ?? { skill: null, contentRef: null };
  }

  /**
   * TODOS los nodos de taxonomía etiquetados en un ítem (1 query), con su código,
   * tipo de tag (primary/secondary) y origen (human/ai). Ordenados primary→
   * secondary, luego por tipo de nodo y nombre, para un agrupado estable en la UI.
   */
  private async loadAllItemTags(itemId: string): Promise<QuestionTaxonomyTag[]> {
    const rows = await this.db
      .select({
        nodeId: taxonomyNodes.id,
        nodeName: taxonomyNodes.name,
        nodeType: sql<string>`${taxonomyNodes.type}::text`,
        nodeCode: taxonomyNodes.code,
        tagType: sql<string>`${itemTaxonomyTags.tagType}::text`,
        taggedBy: sql<string>`${itemTaxonomyTags.taggedBy}::text`,
      })
      .from(itemTaxonomyTags)
      .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, itemTaxonomyTags.nodeId))
      .where(eq(itemTaxonomyTags.itemId, itemId))
      .orderBy(
        asc(itemTaxonomyTags.tagType),
        asc(taxonomyNodes.type),
        asc(taxonomyNodes.name),
      );

    return rows.map((r) => ({
      nodeId: r.nodeId,
      nodeName: r.nodeName,
      nodeType: r.nodeType,
      nodeCode: r.nodeCode ?? null,
      tagType: r.tagType,
      taggedBy: r.taggedBy,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scoping & multi-tenancy (replican AssessmentResultsService/AnalyticsService)
  // ───────────────────────────────────────────────────────────────────────────

  /** `org_id` SIEMPRE del token. */
  private requireOrgId(user: JwtPayload): string {
    if (user.orgId) return user.orgId;
    throw new ForbiddenException('Usuario sin organización asociada');
  }

  private async getAccessibleClassGroupIds(
    user: JwtPayload,
    orgId: string,
  ): Promise<ScopeResult> {
    if (user.isPlatformAdmin) return { scopeAll: true, classGroupIds: [] };

    const adminLike = userHasAnyRole(user.roles, ADMIN_LIKE_ROLES);
    if (adminLike) return { scopeAll: true, classGroupIds: [] };

    if (!userHasAnyRole(user.roles, RESULTS_VIEWER_ROLES)) {
      return { scopeAll: false, classGroupIds: [] };
    }

    const rows = await this.db
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

  /**
   * Verifica que el assessment exista y pertenezca al org del caller. Lanza 404
   * — no filtra existencia entre orgs. Devuelve también nombre de instrumento.
   */
  private async requireAssessmentOwnedByUser(
    user: JwtPayload,
    orgId: string,
    assessmentId: string,
  ): Promise<{
    id: string;
    orgId: string;
    instrumentId: string;
    name: string | null;
    instrumentName: string;
  }> {
    const [row] = await this.db
      .select({
        id: assessments.id,
        orgId: assessments.orgId,
        instrumentId: assessments.instrumentId,
        name: assessments.name,
        instrumentName: instruments.name,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(
        and(eq(assessments.id, assessmentId), isNull(instruments.deletedAt)),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Evaluación no encontrada');
    }
    if (!user.isPlatformAdmin && row.orgId !== orgId) {
      throw new NotFoundException('Evaluación no encontrada');
    }
    return row;
  }

  /** El ítem debe pertenecer a un instrumento de la org del caller. */
  private async requireItemVisible(
    user: JwtPayload,
    orgId: string,
    itemId: string,
  ): Promise<{
    id: string;
    instrumentId: string | null;
    position: number;
    type: string;
    content: Record<string, unknown>;
  }> {
    const [row] = await this.db
      .select({
        id: items.id,
        orgId: items.orgId,
        instrumentId: items.instrumentId,
        instrumentOrgId: instruments.orgId,
        position: items.position,
        type: sql<string>`${items.type}::text`,
        content: items.content,
      })
      .from(items)
      .leftJoin(instruments, eq(instruments.id, items.instrumentId))
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('Pregunta no encontrada');
    }

    const itemOrg = row.orgId ?? row.instrumentOrgId;
    if (!user.isPlatformAdmin && itemOrg !== orgId) {
      throw new NotFoundException('Pregunta no encontrada');
    }

    return {
      id: row.id,
      instrumentId: row.instrumentId,
      position: row.position,
      type: row.type,
      content: row.content,
    };
  }

  /** ¿La evaluación toca alguno de los class_groups del scope? */
  private async assessmentTouchesScope(
    assessmentId: string,
    classGroupIds: string[],
  ): Promise<boolean> {
    if (classGroupIds.length === 0) return false;
    const [row] = await this.db
      .select({ classGroupId: assessmentCourseAssignments.classGroupId })
      .from(assessmentCourseAssignments)
      .where(
        and(
          eq(assessmentCourseAssignments.assessmentId, assessmentId),
          inArray(assessmentCourseAssignments.classGroupId, classGroupIds),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** ¿El classGroup pedido está en el scope del caller y pertenece a la org? */
  private async classGroupInScope(
    orgId: string,
    scope: ScopeResult,
    classGroupId: string,
  ): Promise<boolean> {
    if (scope.scopeAll) {
      const [cg] = await this.db
        .select({ id: classGroups.id })
        .from(classGroups)
        .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)))
        .limit(1);
      return !!cg;
    }
    return scope.classGroupIds.includes(classGroupId);
  }

  /**
   * studentIds visibles combinando scope + filtro por classGroupId. `null` =
   * scopeAll sin filtro (sin filtro extra de student).
   */
  private async resolveAccessibleStudentIds(
    orgId: string,
    scope: ScopeResult,
    classGroupId: string | undefined,
  ): Promise<string[] | null> {
    if (scope.scopeAll && !classGroupId) return null;

    let allowedClassGroupIds: string[];
    if (scope.scopeAll) {
      allowedClassGroupIds = [classGroupId!];
    } else {
      if (classGroupId) {
        if (!scope.classGroupIds.includes(classGroupId)) return [];
        allowedClassGroupIds = [classGroupId];
      } else {
        allowedClassGroupIds = scope.classGroupIds;
      }
    }

    if (allowedClassGroupIds.length === 0) return [];

    const rows = await this.db
      .select({ studentId: studentEnrollments.studentId })
      .from(studentEnrollments)
      .innerJoin(students, eq(students.id, studentEnrollments.studentId))
      .where(
        and(
          inArray(studentEnrollments.classGroupId, allowedClassGroupIds),
          eq(students.orgId, orgId),
          isNull(students.deletedAt),
        ),
      );

    return Array.from(new Set(rows.map((r) => r.studentId)));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Parsing de items.content / responses.value
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Clave correcta: de content.correctKey o, como fallback, de
   * alternatives[].isCorrect. No se hardcodea ningún formato de instrumento.
   */
  private deriveCorrectKey(content: ItemContent): string | null {
    if (typeof content.correctKey === 'string' && content.correctKey.length > 0) {
      return content.correctKey;
    }
    const alts = this.parseAlternatives(content);
    const correct = alts.find((a) => a.isCorrect);
    return correct ? correct.key : null;
  }

  private parseAlternatives(
    content: ItemContent,
  ): { key: string; text: string | null; isCorrect: boolean }[] {
    if (!Array.isArray(content.alternatives)) return [];
    const out: { key: string; text: string | null; isCorrect: boolean }[] = [];
    for (const raw of content.alternatives) {
      if (!raw || typeof raw !== 'object') continue;
      const alt = raw as ItemAlternative;
      if (typeof alt.key !== 'string') continue;
      out.push({
        key: alt.key,
        text: typeof alt.text === 'string' ? alt.text : null,
        isCorrect: alt.isCorrect === true,
      });
    }
    return out;
  }

  /** Extrae la alternativa elegida del JSONB value (raw ?? key ?? answer). */
  private extractRawAnswer(value: Record<string, unknown>): string | null {
    if (!value || typeof value !== 'object') return null;
    const raw =
      (value as Record<string, unknown>).raw ??
      (value as Record<string, unknown>).key ??
      (value as Record<string, unknown>).answer;
    if (raw == null) return null;
    const str = typeof raw === 'string' ? raw : String(raw);
    return str.length > 0 ? str : null;
  }
}
