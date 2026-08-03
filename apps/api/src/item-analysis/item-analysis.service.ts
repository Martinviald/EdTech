import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assessmentCourseAssignments,
  assessmentItemStats,
  assessmentResults,
  assessments,
  classGroups,
  grades,
  instruments,
  instrumentSections,
  itemTaxonomyTags,
  items,
  responses,
  sectionAttachments,
  studentEnrollments,
  students,
  subjectClasses,
  subjects,
  taxonomyNodes,
  teacherAssignments,
  withOrgContext,
} from '@soe/db';
import {
  RESULTS_VIEWER_ROLES,
  RESULT_HIDDEN_NODE_TYPES,
  TRUE_FALSE_KEYS,
  TRUE_FALSE_LABELS,
  isTrueFalseContent,
  parseSelectedKeys,
  mergeAnswerCounts,
  trueFalseKeyOf,
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
  type MatrixReferenceScopes,
  type MatrixStudentRow,
  type QuestionAnalysisQueryDto,
  type QuestionReferences,
  type ReferenceRate,
  type QuestionAnalysisResponse,
  type QuestionSection,
  type QuestionTaxonomyTag,
  type UserRole,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { loadCohortAchievementByAssessment } from '../common/helpers/cohort-item-stats.helper';
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
    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);

      // Profesor sin cursos asignados → no ve evaluaciones.
      if (!scope.scopeAll && scope.classGroupIds.length === 0) {
        return { data: [] };
      }

      // Sólo evaluaciones con resultados (para que la matriz nunca salga vacía).
      //
      // §2.7 del plan — "resultados" es niveles por alumno (assessment_results) O
      // analítica de cohorte (assessment_item_stats). Sin la segunda rama, una
      // evaluación cargada desde un informe oficial (que puede no traer niveles por
      // alumno) desaparecería de TODA la app: no la listarían /evaluaciones,
      // /dashboard ni /material-remedial, y su hub sólo sería alcanzable por URL.
      // Esto desacopla la visibilidad del pipeline de OCR de la Figura 1, que es el
      // frágil de los dos. No cambia nada para lo existente: todo assessment con
      // responses tiene assessment_results.
      const conditions = [
        eq(assessments.orgId, orgId),
        isNull(instruments.deletedAt),
        sql`(exists (select 1 from ${assessmentResults} where ${assessmentResults.assessmentId} = ${assessments.id})
          or exists (select 1 from ${assessmentItemStats} where ${assessmentItemStats.assessmentId} = ${assessments.id}))`,
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
        conditions.push(inArray(assessmentCourseAssignments.classGroupId, scope.classGroupIds));
      }

      // El join a course_assignments multiplica por curso; group by colapsa a una
      // fila por evaluación. gradeName representativo vía max() (una evaluación
      // suele apuntar a un grado).
      const rows = await tx
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
        const enr = await tx
          .select({ studentId: studentEnrollments.studentId })
          .from(studentEnrollments)
          .where(inArray(studentEnrollments.classGroupId, scope.classGroupIds));
        scopedStudentIds = Array.from(new Set(enr.map((r) => r.studentId)));
      }

      const countConds = [inArray(assessmentResults.assessmentId, ids)];
      if (scopedStudentIds !== null) {
        countConds.push(inArray(assessmentResults.studentId, scopedStudentIds));
      }
      const countRows = await tx
        .select({
          assessmentId: assessmentResults.assessmentId,
          count: sql<number>`count(distinct ${assessmentResults.studentId})::int`,
        })
        .from(assessmentResults)
        .where(and(...countConds))
        .groupBy(assessmentResults.assessmentId);
      const countByAssessment = new Map(countRows.map((r) => [r.assessmentId, Number(r.count)]));

      // Una evaluación cargada desde un informe oficial (`aggregate_only`) no tiene
      // filas por alumno: su N vive en el read-model de cohorte. Esta lista ya las
      // MUESTRA (ver la rama `exists(assessment_item_stats)` de arriba), así que sin
      // este fallback aparecían con "0 alumnos" mientras su propio hub —que sí usa
      // el read-model— mostraba la asistencia correcta.
      //
      // Misma definición de N que el resto de la app (`buildAggregateSummary`,
      // `getOverview`): Σ del max(student_count) por curso, vía el helper compartido.
      const cohortRows = await loadCohortAchievementByAssessment(
        tx,
        ids,
        scope.scopeAll ? null : scope.classGroupIds,
      );
      const cohortByAssessment = new Map(
        cohortRows.map((r) => [r.assessmentId, r.studentsAssessed]),
      );

      const data: AssessmentOption[] = rows.map((r) => ({
        assessmentId: r.assessmentId,
        name: r.name,
        instrumentName: r.instrumentName,
        instrumentType: r.instrumentType,
        subjectName: r.subjectName ?? null,
        gradeName: r.gradeName ?? null,
        administeredAt: r.administeredAt,
        // El dato per-alumno manda cuando existe (es el N real de rendidores); el de
        // cohorte sólo cubre a las que no lo tienen. Para una evaluación con ambos,
        // los dos números son la misma cohorte.
        studentsCount:
          countByAssessment.get(r.assessmentId) ?? cohortByAssessment.get(r.assessmentId) ?? 0,
      }));

      return { data };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // H6.11 — GET /api/item-analysis/matrix
  // ───────────────────────────────────────────────────────────────────────────

  async getMatrix(user: JwtPayload, query: ItemMatrixQueryDto): Promise<ItemMatrixResponse> {
    const orgId = this.requireOrgId(user);
    return withOrgContext(this.db, orgId, async (tx) => {
      const assessment = await this.requireAssessmentOwnedByUser(
        tx,
        user,
        orgId,
        query.assessmentId,
      );
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);

      // Profesor sin scope sobre esta evaluación → Forbidden.
      if (!scope.scopeAll) {
        const hasScope = await this.assessmentTouchesScope(
          tx,
          query.assessmentId,
          scope.classGroupIds,
        );
        if (!hasScope) {
          throw new ForbiddenException('No tiene acceso a los resultados de esta evaluación');
        }
      }

      // Si pasa classGroupId, validar que está en el scope y pertenece a la org.
      if (query.classGroupId) {
        const ok = await this.classGroupInScope(tx, orgId, scope, query.classGroupId);
        if (!ok) {
          throw new ForbiddenException('No tiene acceso a ese curso');
        }
      }

      // ── Columnas: ítems del instrumento de la evaluación ──────────────────────
      // TKT-12 — filtro por nodeId (single, drill-down de habilidad) y/o tagIds
      // (multi-tag OR). Se combinan como unión: un ítem se muestra si tiene
      // cualquiera de los nodos/tags provistos.
      const questions = await this.loadQuestionColumns(
        tx,
        assessment.instrumentId,
        query.nodeId,
        query.tagIds,
      );
      const itemIds = questions.map((q) => q.itemId);

      // Dos resoluciones del MISMO scope, para dos capas distintas:
      //  · classGroupFilter → la capa agregable (read-model de cohorte, grano por curso).
      //  · studentFilter    → la matriz alumno×pregunta, irreducible sobre `responses`.
      // Ambas derivan de (scope, classGroupId) y `null` significa lo mismo en las dos:
      // scopeAll sin filtro. Ver resolveAccessibleClassGroupIds.
      const classGroupFilter = this.resolveAccessibleClassGroupIds(scope, query.classGroupId);
      const studentFilter = await this.resolveAccessibleStudentIds(
        tx,
        orgId,
        scope,
        query.classGroupId,
      );

      const questionsWithRate = await this.attachCorrectRates(
        tx,
        query.assessmentId,
        questions,
        itemIds,
        classGroupFilter,
      );

      // TKT-22 — línea de referencia "% de logro del colegio" por pregunta: el
      // promedio de TODA la org, con independencia del scope del usuario. La línea
      // de "muestra de colegios" (benchmark inter-colegio) queda DIFERIDA hasta
      // existir un pool multi-colegio (references.sample; ver QuestionReferences).
      const references = await this.attachLevelReferences(
        tx,
        orgId,
        query.assessmentId,
        assessment.instrumentId,
        questionsWithRate,
        itemIds,
      );

      // ── Alumnos visibles con respuestas en la evaluación ──────────────────────
      // TKT-09 — con `all=true` se devuelve el curso COMPLETO (sin paginar) para
      // que el frontend pueda ordenar alumnos/preguntas por % de logro en cliente.
      const pagination = await this.loadStudentsPage(
        tx,
        query.assessmentId,
        orgId,
        studentFilter,
        query.page,
        query.limit,
        query.all,
      );

      const pageStudentIds = pagination.data.map((s) => s.studentId);

      // ── Respuestas de la página de alumnos (1 query, inArray) → celdas ────────
      const cellsByStudent = await this.loadCells(tx, query.assessmentId, pageStudentIds, itemIds);

      const students: MatrixStudentRow[] = pagination.data.map((s) => {
        const byItem = cellsByStudent.get(s.studentId) ?? new Map<string, MatrixCell>();
        let correctCount = 0;
        let answeredCount = 0;
        const cells: MatrixCell[] = itemIds.map((itemId) => {
          const cell = byItem.get(itemId);
          if (!cell) {
            return { itemId, selectedKey: null, isCorrect: null, score: null, maxScore: null };
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
        questions: references.questions,
        references: references.scopes,
        students: {
          data: students,
          total: pagination.total,
          // Con `all=true` no hay paginación: reportamos una sola página con todo.
          page: query.all ? 1 : query.page,
          limit: query.all ? pagination.total : query.limit,
        },
      };
    });
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
    return withOrgContext(this.db, orgId, async (tx) => {
      const scope = await this.getAccessibleClassGroupIds(tx, user, orgId);

      // El ítem debe pertenecer a un instrumento de la org del caller.
      const item = await this.requireItemVisible(tx, user, orgId, itemId);

      // Si viene assessmentId, validar pertenencia a la org + scope del profesor.
      if (query.assessmentId) {
        const assessment = await this.requireAssessmentOwnedByUser(
          tx,
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
            tx,
            query.assessmentId,
            scope.classGroupIds,
          );
          if (!hasScope) {
            throw new ForbiddenException('No tiene acceso a los resultados de esta evaluación');
          }
        }
      }

      if (query.classGroupId) {
        const ok = await this.classGroupInScope(tx, orgId, scope, query.classGroupId);
        if (!ok) {
          throw new ForbiddenException('No tiene acceso a ese curso');
        }
      }

      // Todo el detalle por pregunta es agregable → basta el scope resuelto a cursos.
      // (Antes se resolvía a alumnos con una query a student_enrollments que ya no
      // hace falta: el read-model tiene grano por curso.)
      const classGroupFilter = this.resolveAccessibleClassGroupIds(scope, query.classGroupId);

      const content = (item.content ?? {}) as ItemContent;
      // En multi-selección no existe UNA clave correcta: la respuesta es un
      // conjunto. `correctKey` queda null y son las alternativas las que llevan
      // el `isCorrect` — exponer la primera correcta como "la" clave mentiría.
      const isMultiSelect = item.type === 'multi_select';
      const altDefs = this.parseAlternatives(content);
      const altKeys = altDefs.map((alt) => alt.key);
      const correctKey = isMultiSelect ? null : this.deriveCorrectKey(content);

      const { skill, contentRef } = await this.loadItemTags(tx, itemId);
      const tags = await this.loadAllItemTags(tx, itemId);
      const section = item.sectionId ? await this.loadQuestionSection(tx, item.sectionId) : null;

      // ── Distribución agregada por valor de respuesta (read-model de cohorte) ──
      const dist = await this.loadAnswerDistribution(
        tx,
        itemId,
        query.assessmentId,
        classGroupFilter,
      );

      let totalResponses = 0;
      let blankCount = 0;
      let correctCount = 0;
      const countByKey = new Map<string, number>();
      for (const row of dist) {
        totalResponses += row.count;
        if (row.answer === null) {
          blankCount += row.count;
        } else if (isMultiSelect) {
          // En multi-selección la respuesta es un CONJUNTO (`"145"`): se cuenta
          // una vez por cada opción marcada, así la barra de cada alternativa
          // dice "% de alumnos que la marcó". Los porcentajes suman más de 100
          // a propósito — un alumno aporta a varias barras.
          const selected = parseSelectedKeys(row.answer, altKeys);
          if (selected === null || selected.size === 0) {
            countByKey.set(row.answer, (countByKey.get(row.answer) ?? 0) + row.count);
          } else {
            for (const key of selected) countByKey.set(key, (countByKey.get(key) ?? 0) + row.count);
          }
        } else {
          // En un V/F la hoja puede traer `V`, `VERDADERO`, `TRUE` o `A` para lo
          // mismo: se colapsan a la clave canónica con el MISMO criterio que usa
          // la corrección, o la distribución contradiría al % de logro.
          const key = isTrueFalseContent(content)
            ? (trueFalseKeyOf(row.answer) ?? row.answer)
            : row.answer;
          countByKey.set(key, (countByKey.get(key) ?? 0) + row.count);
        }
        if (row.isCorrect) correctCount += row.count;
      }

      const correctRate = totalResponses > 0 ? (correctCount / totalResponses) * 100 : null;

      // T2-17 — referencias comparativas: % de logro de la MISMA pregunta en el
      // colegio (toda la org) y en el nivel/grado. Independientes del scope del
      // usuario (líneas de referencia), acotadas a la org por `assessmentId`.
      const references = await this.loadQuestionReferences(
        tx,
        orgId,
        item.instrumentId,
        query.assessmentId,
        itemId,
        query.classGroupId,
      );

      // Recortes por alternativa (ítems con opciones-imagen). Se expone solo el flag; la
      // imagen se sirve firmada por `/items/{id}/alternativa/{key}/figura`.
      const altImageRefs = (item.scoringConfig?.altImageRefs ?? null) as Record<
        string,
        unknown
      > | null;
      const alternatives: AlternativeDistribution[] = altDefs.map((alt) => {
        const count = countByKey.get(alt.key) ?? 0;
        return {
          key: alt.key,
          text: alt.text,
          isCorrect: correctKey != null ? alt.key === correctKey : alt.isCorrect,
          count,
          percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0,
          hasImage: !!altImageRefs && typeof altImageRefs[alt.key] === 'string',
        };
      });

      return {
        itemId,
        position: item.position,
        type: item.type,
        stem: typeof content.stem === 'string' ? content.stem : null,
        imageUrl: typeof content.imageUrl === 'string' ? content.imageUrl : null,
        // La figura vive en `files` (owner_type='item'); acá solo se expone el flag
        // para que la UI decida si ofrecer el botón, sin firmar una URL por ítem.
        hasFigure: typeof item.scoringConfig?.imageRef === 'string',
        explanation: typeof content.explanation === 'string' ? content.explanation : null,
        correctKey,
        skill,
        content: contentRef,
        tags,
        section,
        totalResponses,
        blankCount,
        correctCount,
        correctRate,
        references,
        alternatives,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Query helpers (sin N+1)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Columnas de la matriz: ítems del instrumento, opcionalmente filtrados por
   * nodeId (single) y/o tagIds (multi, OR). Ambos se combinan en una unión de
   * nodos: el ítem se muestra si tiene CUALQUIERA de los nodos/tags provistos.
   */
  private async loadQuestionColumns(
    tx: Database,
    instrumentId: string,
    nodeId: string | undefined,
    tagIds: string[] | undefined,
  ): Promise<MatrixQuestionColumn[]> {
    const conditions = [eq(items.instrumentId, instrumentId), isNull(items.deletedAt)];

    const rows = await tx
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
    const tagsByItem = await this.loadTagsByItems(tx, itemIds);

    let columns: MatrixQuestionColumn[] = rows.map((r) => {
      const content = (r.content ?? {}) as ItemContent;
      const refs = tagsByItem.get(r.itemId) ?? { skill: null, contentRef: null };
      const maxScore =
        r.scoringConfig && typeof r.scoringConfig.points === 'number' ? r.scoringConfig.points : 1;
      return {
        itemId: r.itemId,
        position: r.position,
        type: r.type,
        maxScore,
        correctKey: this.deriveCorrectKey(content),
        skill: refs.skill,
        content: refs.contentRef,
        correctRate: null,
        // sample queda en undefined → línea de "muestra de colegios" DIFERIDA (TKT-20).
        references: { grade: { rate: null, responseCount: 0, correctCount: 0 } },
      };
    });

    // Filtro por nodos/tags (nodeId ∪ tagIds): limita las columnas a ítems que
    // tengan CUALQUIERA de esos nodos (semántica OR — TKT-12). Consulta el set
    // completo de item_taxonomy_tags (primary + secondary), no sólo los tags
    // representativos, para un filtro exacto.
    const filterNodeIds = Array.from(new Set([...(nodeId ? [nodeId] : []), ...(tagIds ?? [])]));
    if (filterNodeIds.length > 0 && columns.length > 0) {
      const tagged = await tx
        .select({ itemId: itemTaxonomyTags.itemId })
        .from(itemTaxonomyTags)
        .where(
          and(
            inArray(
              itemTaxonomyTags.itemId,
              columns.map((c) => c.itemId),
            ),
            inArray(itemTaxonomyTags.nodeId, filterNodeIds),
          ),
        );
      const taggedItemIds = new Set(tagged.map((t) => t.itemId));
      columns = columns.filter((c) => taggedItemIds.has(c.itemId));
    }

    return columns;
  }

  /**
   * Tasa de acierto por ítem, desde el read-model de cohorte (1 query agregada).
   *
   * ⚠️ Recombinar cursos es SUMA de conteos, nunca promedio de porcentajes: los
   * cursos tienen N distinto y promediar sus % los ponderaría igual. Por eso el
   * read-model guarda enteros y el % se recalcula acá sobre el total recombinado.
   *
   * Paridad con el `GROUP BY` sobre `responses` que reemplaza:
   *  · `responseCount` es el `count(*)` de filas de respuesta del ítem → incluye los
   *    blancos en el denominador, igual que antes.
   *  · `correctCount` es el `sum(case when is_correct = true ...)` → `null` sigue
   *    contando como incorrecto (no se excluye del denominador).
   */
  private async attachCorrectRates(
    tx: Database,
    assessmentId: string,
    questions: MatrixQuestionColumn[],
    itemIds: string[],
    classGroupFilter: string[] | null,
  ): Promise<MatrixQuestionColumn[]> {
    if (itemIds.length === 0) return questions;
    if (classGroupFilter !== null && classGroupFilter.length === 0) {
      return questions.map((q) => ({ ...q, correctRate: null }));
    }

    const conditions = [
      eq(assessmentItemStats.assessmentId, assessmentId),
      inArray(assessmentItemStats.itemId, itemIds),
    ];
    if (classGroupFilter !== null) {
      conditions.push(inArray(assessmentItemStats.classGroupId, classGroupFilter));
    }

    const rows = await tx
      .select({
        itemId: assessmentItemStats.itemId,
        total: sql<number>`sum(${assessmentItemStats.responseCount})::int`,
        correct: sql<number>`sum(${assessmentItemStats.correctCount})::int`,
      })
      .from(assessmentItemStats)
      .where(and(...conditions))
      .groupBy(assessmentItemStats.itemId);

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

  /**
   * T2-17 — "% de logro del nivel" por pregunta: la línea de referencia del
   * tablero maestro.
   *
   * ⚠️ El predicado NO incluye `assessmentId`. El modelo crea una `assessment`
   * POR CURSO (`assessment_course_assignments`), así que acotar por ella dejaría
   * fuera al curso hermano y la referencia saldría IDÉNTICA a la del curso mirado
   * — que es exactamente el bug que esto corrige. La población es
   * (org, instrumento, grade_id, año académico).
   *
   * Ponderada por alumno: `sum(correctCount)/sum(responseCount)` sobre las cohortes
   * del nivel. NUNCA el promedio de los % de cada curso — cursos de distinto N
   * pesarían igual y el número sería falso.
   *
   * La query corre dentro de `withOrgContext` y filtra `assessments.orgId`
   * explícitamente: nunca cruza datos de otra org (RLS + filtro manual, §5.2). Es
   * independiente del scope del usuario, que es el punto de una referencia: un
   * profesor ve su curso en `correctRate` y el nivel completo acá.
   *
   * `references.sample` (muestra de colegios / benchmark inter-colegio) queda
   * DIFERIDO: requiere pool multi-colegio (TKT-20). Se deja el hueco en el
   * contrato (`QuestionReferences.sample`) sin poblarlo.
   */
  private async attachLevelReferences(
    tx: Database,
    orgId: string,
    assessmentId: string,
    instrumentId: string,
    questions: MatrixQuestionColumn[],
    itemIds: string[],
  ): Promise<{ questions: MatrixQuestionColumn[]; scopes: MatrixReferenceScopes }> {
    const noData: ReferenceRate = { rate: null, responseCount: 0, correctCount: 0 };
    const emptyScopes: MatrixReferenceScopes = {
      grade: { rate: null, gradeName: null, classGroupCount: 0, studentCount: 0 },
    };
    if (itemIds.length === 0) return { questions, scopes: emptyScopes };

    const cohort = await this.resolveReferenceCohort(tx, assessmentId);
    if (cohort === null) return { questions, scopes: emptyScopes };

    const rows = await this.loadReferenceRows(
      tx,
      orgId,
      instrumentId,
      cohort.gradeIds,
      cohort.yearIds,
      itemIds,
    );
    const agg = this.aggregateReference(rows);

    return {
      questions: questions.map((q) => ({
        ...q,
        references: { ...q.references, grade: agg.byItem.get(q.itemId) ?? noData },
      })),
      scopes: { grade: { ...agg.summary, gradeName: cohort.gradeName } },
    };
  }

  /**
   * Grados y años académicos que cubre una evaluación — el "contexto" del que
   * cuelga la línea de referencia. `null` si no tiene cursos asignados (sin
   * cohorte no hay referencia bien definida).
   */
  private async resolveReferenceCohort(
    tx: Database,
    assessmentId: string,
  ): Promise<{ gradeIds: string[]; yearIds: string[]; gradeName: string | null } | null> {
    const cohort = await tx
      .selectDistinct({
        gradeId: classGroups.gradeId,
        gradeName: grades.name,
        academicYearId: classGroups.academicYearId,
      })
      .from(assessmentCourseAssignments)
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .where(eq(assessmentCourseAssignments.assessmentId, assessmentId));

    const gradeIds = [...new Set(cohort.map((c) => c.gradeId))];
    const yearIds = [...new Set(cohort.map((c) => c.academicYearId))];
    if (gradeIds.length === 0 || yearIds.length === 0) return null;

    return { gradeIds, yearIds, gradeName: cohort.length === 1 ? cohort[0].gradeName : null };
  }

  /**
   * Filas del read-model de cohorte que componen la población del nivel: TODOS los
   * cursos de la org, de esos grados, que rindieron ese instrumento en esos años —
   * sin importar bajo qué `assessment`. Volumen acotado: filas = ítems × cursos
   * del nivel.
   */
  private async loadReferenceRows(
    tx: Database,
    orgId: string,
    instrumentId: string,
    gradeIds: string[],
    yearIds: string[],
    itemIds: string[],
  ): Promise<
    Array<{
      itemId: string;
      classGroupId: string;
      studentCount: number;
      responseCount: number;
      correctCount: number;
    }>
  > {
    return tx
      .select({
        itemId: assessmentItemStats.itemId,
        classGroupId: assessmentItemStats.classGroupId,
        studentCount: assessmentItemStats.studentCount,
        responseCount: assessmentItemStats.responseCount,
        correctCount: assessmentItemStats.correctCount,
      })
      .from(assessmentItemStats)
      .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
      .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
      .where(
        and(
          eq(assessments.orgId, orgId),
          eq(assessments.instrumentId, instrumentId),
          inArray(classGroups.gradeId, gradeIds),
          inArray(classGroups.academicYearId, yearIds),
          inArray(assessmentItemStats.itemId, itemIds),
        ),
      );
  }

  /**
   * Agrega las filas del read-model en (a) conteos por ítem — las celdas de la
   * fila de referencia — y (b) el resumen de toda la población, que es
   * `sum(correctCount) / sum(responseCount)` sobre TODAS las respuestas de TODOS
   * sus alumnos. Nunca un promedio de los % por curso: los cursos tienen N distinto
   * y promediar sus % los ponderaría igual (mismo criterio que `attachCorrectRates`).
   *
   * `studentCount` viene por (assessment, curso, ítem) y se repite en cada ítem del
   * mismo curso → se toma el `max` por curso y recién ahí se suma; si no, se
   * contaría cada alumno tantas veces como preguntas tiene la prueba.
   */
  private aggregateReference(
    rows: Array<{
      itemId: string;
      classGroupId: string;
      studentCount: number;
      responseCount: number;
      correctCount: number;
    }>,
  ): {
    byItem: Map<string, ReferenceRate>;
    summary: { rate: number | null; classGroupCount: number; studentCount: number };
  } {
    const byItem = new Map<string, ReferenceRate>();
    const studentsByGroup = new Map<string, number>();
    let totalResponses = 0;
    let totalCorrect = 0;

    for (const r of rows) {
      const responseCount = Number(r.responseCount);
      const correctCount = Number(r.correctCount);
      const acc = byItem.get(r.itemId) ?? { rate: null, responseCount: 0, correctCount: 0 };
      acc.responseCount += responseCount;
      acc.correctCount += correctCount;
      byItem.set(r.itemId, acc);

      totalResponses += responseCount;
      totalCorrect += correctCount;

      const prev = studentsByGroup.get(r.classGroupId) ?? 0;
      studentsByGroup.set(r.classGroupId, Math.max(prev, Number(r.studentCount)));
    }

    for (const acc of byItem.values()) {
      acc.rate = acc.responseCount > 0 ? (acc.correctCount / acc.responseCount) * 100 : 0;
    }

    let studentCount = 0;
    for (const n of studentsByGroup.values()) studentCount += n;

    return {
      byItem,
      summary: {
        rate: totalResponses > 0 ? (totalCorrect / totalResponses) * 100 : null,
        classGroupCount: studentsByGroup.size,
        studentCount,
      },
    };
  }

  /**
   * T2-17 — Referencia comparativa de UNA pregunta para el panel de detalle: el
   * % de logro de la MISMA pregunta en el NIVEL/grado. Es el análogo por-pregunta
   * de `attachLevelReferences` y comparte su población EXACTA, para que el panel
   * no contradiga al tablero que lo abrió.
   *
   * Semántica (idéntica a `attachLevelReferences`):
   *  · IGNORA el scope del usuario — es una línea de comparación: un profesor ve
   *    su curso en `correctRate` y el nivel completo aquí.
   *  · Se acota a la org por construcción: corre dentro de `withOrgContext` y
   *    filtra `assessments.orgId` explícitamente.
   *  · Recombinar cursos es SUMA de conteos, nunca promedio de % (los cursos
   *    tienen N distinto): se suman `response_count`/`correct_count` y el % se
   *    recalcula sobre el total.
   *
   * `grade` = Σ de los cursos del grado en contexto (el del `classGroupId` si
   *           viene; si no, los de la evaluación) que rindieron el mismo
   *           instrumento ese año — incluidos los cursos hermanos que viven en
   *           OTRA evaluación. ⚠️ Antes se acotaba por `assessmentId`, con lo que
   *           el "nivel" era el propio curso.
   *
   * Sin `assessmentId` (o sin instrumento: ítem suelto del banco) no hay cohorte
   * de la cual derivar grado/año → `rate: null`.
   */
  private async loadQuestionReferences(
    tx: Database,
    orgId: string,
    instrumentId: string | null,
    assessmentId: string | undefined,
    itemId: string,
    classGroupId: string | undefined,
  ): Promise<QuestionReferences> {
    const empty: ReferenceRate = { rate: null, responseCount: 0, correctCount: 0 };
    if (!assessmentId || !instrumentId) return { grade: empty };

    const cohort = await this.resolveReferenceCohort(tx, assessmentId);
    if (cohort === null) return { grade: empty };

    // Grado en contexto: el del curso filtrado (si viene); si no, los de la
    // evaluación. Un curso ajeno a la cohorte no acota nada (set vacío → sin datos).
    let gradeIds: string[];
    if (classGroupId) {
      const [cg] = await tx
        .select({ gradeId: classGroups.gradeId })
        .from(classGroups)
        .where(eq(classGroups.id, classGroupId))
        .limit(1);
      gradeIds = cg?.gradeId ? [cg.gradeId] : [];
    } else {
      gradeIds = cohort.gradeIds;
    }
    if (gradeIds.length === 0) return { grade: empty };

    const rows = await this.loadReferenceRows(tx, orgId, instrumentId, gradeIds, cohort.yearIds, [
      itemId,
    ]);

    return { grade: this.aggregateReference(rows).byItem.get(itemId) ?? empty };
  }

  /** Alumnos con respuestas en la evaluación dentro del scope, paginados. */
  private async loadStudentsPage(
    tx: Database,
    assessmentId: string,
    orgId: string,
    studentFilter: string[] | null,
    page: number,
    limit: number,
    all: boolean,
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
    const [countRow] = await tx
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
    const baseQuery = tx
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
      .orderBy(asc(students.lastName), asc(students.firstName));

    // TKT-09 — `all` devuelve el curso completo (sin limit/offset) para ordenar en
    // el cliente; en modo normal se pagina con limit/offset.
    const rows = all ? await baseQuery : await baseQuery.limit(limit).offset((page - 1) * limit);

    // Curso de cada alumno relevante a ESTA evaluación (1 query), resuelto aparte
    // para no inflar la página. Un alumno → un único curso (DISTINCT ON).
    const classGroupByStudent = await this.loadStudentClassGroups(
      tx,
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
    tx: Database,
    assessmentId: string,
    studentIds: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const result = new Map<string, { id: string; name: string }>();
    if (studentIds.length === 0) return result;

    const rows = await tx
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
    tx: Database,
    assessmentId: string,
    studentIds: string[],
    itemIds: string[],
  ): Promise<Map<string, Map<string, MatrixCell>>> {
    const result = new Map<string, Map<string, MatrixCell>>();
    if (studentIds.length === 0 || itemIds.length === 0) return result;

    const rows = await tx
      .select({
        studentId: responses.studentId,
        itemId: responses.itemId,
        value: responses.value,
        isCorrect: responses.isCorrect,
        finalScore: responses.finalScore,
        rawScore: responses.rawScore,
        maxScore: responses.maxScore,
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
        maxScore: r.maxScore != null ? Number(r.maxScore) : null,
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

  /**
   * Distribución agregada de respuestas por valor de alternativa, desde el
   * read-model de cohorte (1 query).
   *
   * `assessmentId` es OPCIONAL: sin él, el ítem se agrega across assessments, que
   * sobre el read-model es la suma de las filas de varios assessments. Es legítimo
   * aunque mezcle orígenes (`computed`/`imported`), porque el read-model es
   * homogéneo en tipo: siempre conteos con la misma semántica.
   *
   * Los buckets llegan pre-agrupados por (key, isCorrect) — el mismo agrupamiento
   * que hacía el `group by answer, is_correct` sobre `responses`, incluida la
   * precedencia `raw ?? key ?? answer` que ahora vive una sola vez en el calculador
   * puro (`extractRawAnswer` de @soe/types). `key: null` = blanco.
   *
   * En ítems de desarrollo la clave es la categoría por puntaje ('RC'|'RPC'|'RI'),
   * no una alternativa. No estorba acá: `alternatives` se arma cruzando contra las
   * altDefs de `items.content`, que en desarrollo están vacías, así que esos buckets
   * sólo alimentan totalResponses/correctCount.
   */
  private async loadAnswerDistribution(
    tx: Database,
    itemId: string,
    assessmentId: string | undefined,
    classGroupFilter: string[] | null,
  ): Promise<{ answer: string | null; isCorrect: boolean; count: number }[]> {
    if (classGroupFilter !== null && classGroupFilter.length === 0) return [];

    const conditions = [eq(assessmentItemStats.itemId, itemId)];
    if (assessmentId) {
      conditions.push(eq(assessmentItemStats.assessmentId, assessmentId));
    }
    if (classGroupFilter !== null) {
      conditions.push(inArray(assessmentItemStats.classGroupId, classGroupFilter));
    }

    const rows = await tx
      .select({ answerCounts: assessmentItemStats.answerCounts })
      .from(assessmentItemStats)
      .where(and(...conditions));

    // Recombinación entre cohortes: SUMA de conteos por (key, isCorrect).
    const merged = mergeAnswerCounts(rows.map((r) => r.answerCounts ?? []));
    return merged.map((b) => ({ answer: b.key, isCorrect: b.isCorrect, count: b.count }));
  }

  /**
   * Tags representativos por ítem (1 query). skill = primer tag cuyo nodo NO es
   * de contenido/OA (preferencia primary); content = primer tag cuyo nodo es de
   * contenido/OA.
   */
  private async loadTagsByItems(
    tx: Database,
    itemIds: string[],
  ): Promise<Map<string, { skill: ItemTaxonomyRef | null; contentRef: ItemTaxonomyRef | null }>> {
    const map = new Map<
      string,
      { skill: ItemTaxonomyRef | null; contentRef: ItemTaxonomyRef | null }
    >();
    if (itemIds.length === 0) return map;

    const rows = await tx
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
      // TKT-05 — un descriptor no es la habilidad/contenido representativo del ítem
      // en la matriz de resultados (sigue disponible en el banco de ítems).
      if ((RESULT_HIDDEN_NODE_TYPES as readonly string[]).includes(r.nodeType)) {
        continue;
      }
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
    tx: Database,
    itemId: string,
  ): Promise<{ skill: ItemTaxonomyRef | null; contentRef: ItemTaxonomyRef | null }> {
    const map = await this.loadTagsByItems(tx, [itemId]);
    return map.get(itemId) ?? { skill: null, contentRef: null };
  }

  /**
   * TODOS los nodos de taxonomía etiquetados en un ítem (1 query), con su código,
   * tipo de tag (primary/secondary) y origen (human/ai). Ordenados primary→
   * secondary, luego por tipo de nodo y nombre, para un agrupado estable en la UI.
   */
  private async loadAllItemTags(tx: Database, itemId: string): Promise<QuestionTaxonomyTag[]> {
    const rows = await tx
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
      .orderBy(asc(itemTaxonomyTags.tagType), asc(taxonomyNodes.type), asc(taxonomyNodes.name));

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
    tx: Database,
    user: JwtPayload,
    orgId: string,
  ): Promise<ScopeResult> {
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
   * Verifica que el assessment exista y pertenezca al org del caller. Lanza 404
   * — no filtra existencia entre orgs. Devuelve también nombre de instrumento.
   */
  private async requireAssessmentOwnedByUser(
    tx: Database,
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
    const [row] = await tx
      .select({
        id: assessments.id,
        orgId: assessments.orgId,
        instrumentId: assessments.instrumentId,
        name: assessments.name,
        instrumentName: instruments.name,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .where(and(eq(assessments.id, assessmentId), isNull(instruments.deletedAt)))
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
    tx: Database,
    user: JwtPayload,
    orgId: string,
    itemId: string,
  ): Promise<{
    id: string;
    instrumentId: string | null;
    sectionId: string | null;
    position: number;
    type: string;
    content: Record<string, unknown>;
    scoringConfig: Record<string, unknown> | null;
  }> {
    const [row] = await tx
      .select({
        id: items.id,
        orgId: items.orgId,
        instrumentId: items.instrumentId,
        instrumentOrgId: instruments.orgId,
        sectionId: items.sectionId,
        position: items.position,
        type: sql<string>`${items.type}::text`,
        content: items.content,
        scoringConfig: items.scoringConfig,
      })
      .from(items)
      .leftJoin(instruments, eq(instruments.id, items.instrumentId))
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('Pregunta no encontrada');
    }

    // Visible si es oficial (org null, ej. instrumentos DIA compartidos) o de la
    // org del caller. Sólo se rechaza si pertenece a OTRA org. Misma semántica que
    // buildVisibilityConditions en items.service (org propia + oficiales). Sin el
    // `itemOrg !== null`, la matriz mostraba las preguntas pero el detalle las
    // tumbaba con "Pregunta no encontrada" para todo instrumento oficial.
    const itemOrg = row.orgId ?? row.instrumentOrgId;
    if (!user.isPlatformAdmin && itemOrg !== null && itemOrg !== orgId) {
      throw new NotFoundException('Pregunta no encontrada');
    }

    return {
      id: row.id,
      instrumentId: row.instrumentId,
      sectionId: row.sectionId,
      position: row.position,
      type: row.type,
      content: row.content,
      scoringConfig: row.scoringConfig,
    };
  }

  /** Sección de lectura (texto base + multimedia) del ítem; null si no tiene. */
  private async loadQuestionSection(
    tx: Database,
    sectionId: string,
  ): Promise<QuestionSection | null> {
    const [sec] = await tx
      .select({
        id: instrumentSections.id,
        name: instrumentSections.name,
        passageTitle: instrumentSections.passageTitle,
        passageText: instrumentSections.passageText,
        passageFormat: sql<string | null>`${instrumentSections.passageFormat}::text`,
      })
      .from(instrumentSections)
      .where(eq(instrumentSections.id, sectionId))
      .limit(1);
    if (!sec) return null;

    const atts = await tx
      .select({
        kind: sql<string>`${sectionAttachments.kind}::text`,
        url: sectionAttachments.url,
        storageKey: sectionAttachments.storageKey,
        fileName: sectionAttachments.fileName,
        mimeType: sectionAttachments.mimeType,
        note: sectionAttachments.note,
      })
      .from(sectionAttachments)
      .where(eq(sectionAttachments.sectionId, sectionId))
      .orderBy(asc(sectionAttachments.order));

    return {
      id: sec.id,
      name: sec.name,
      passageTitle: sec.passageTitle ?? null,
      passageText: sec.passageText ?? null,
      passageFormat: sec.passageFormat ?? null,
      attachments: atts.map((a) => ({
        kind: a.kind,
        url: a.url ?? null,
        storageKey: a.storageKey ?? null,
        fileName: a.fileName ?? null,
        mimeType: a.mimeType ?? null,
        note: a.note ?? null,
      })),
    };
  }

  /** ¿La evaluación toca alguno de los class_groups del scope? */
  private async assessmentTouchesScope(
    tx: Database,
    assessmentId: string,
    classGroupIds: string[],
  ): Promise<boolean> {
    if (classGroupIds.length === 0) return false;
    const [row] = await tx
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
    tx: Database,
    orgId: string,
    scope: ScopeResult,
    classGroupId: string,
  ): Promise<boolean> {
    if (scope.scopeAll) {
      const [cg] = await tx
        .select({ id: classGroups.id })
        .from(classGroups)
        .where(and(eq(classGroups.id, classGroupId), eq(classGroups.orgId, orgId)))
        .limit(1);
      return !!cg;
    }
    return scope.classGroupIds.includes(classGroupId);
  }

  /**
   * class_groups visibles combinando scope + filtro por classGroupId. `null` =
   * scopeAll sin filtro (sin filtro extra de curso → todo el assessment).
   *
   * Es el gemelo de `resolveAccessibleStudentIds` para la capa agregable, y sigue
   * exactamente sus mismas ramas — de hecho es su primera mitad: aquel resuelve
   * (scope, classGroupId) → class_groups permitidos y RECIÉN AHÍ los expande a
   * alumnos vía `student_enrollments`. El read-model está pre-agregado por
   * `class_group` usando ese mismo camino (`student_enrollments`, nunca
   * `assessment_course_assignments` — §2.4 del plan), así que filtrar por curso y
   * filtrar por los alumnos de esos cursos seleccionan la misma población. Sin la
   * expansión, acá no hace falta ninguna query.
   *
   * `null` se preserva con cuidado: es lo que habilita el atajo de
   * `null` distingue "admin sin filtro" (toda la población visible) de "scope
   * vacío" (`[]` → sin datos). La línea de referencia (`attachLevelReferences`) NO
   * depende de este valor a propósito: es independiente del scope del usuario.
   */
  private resolveAccessibleClassGroupIds(
    scope: ScopeResult,
    classGroupId: string | undefined,
  ): string[] | null {
    if (scope.scopeAll && !classGroupId) return null;
    if (scope.scopeAll) return [classGroupId!];
    if (classGroupId) {
      return scope.classGroupIds.includes(classGroupId) ? [classGroupId] : [];
    }
    return scope.classGroupIds;
  }

  /**
   * studentIds visibles combinando scope + filtro por classGroupId. `null` =
   * scopeAll sin filtro (sin filtro extra de student).
   *
   * Sólo para la capa granular (matriz alumno×pregunta). La capa agregable usa
   * `resolveAccessibleClassGroupIds`.
   */
  private async resolveAccessibleStudentIds(
    tx: Database,
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

    const rows = await tx
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
    // Un Verdadero/Falso canónico no lleva `alternatives`: su respuesta es un
    // booleano. Se sintetizan las dos opciones para que el análisis por pregunta
    // muestre distribución y clave correcta igual que cualquier otro ítem cerrado.
    if (isTrueFalseContent(content)) {
      return [
        {
          key: TRUE_FALSE_KEYS.true,
          text: TRUE_FALSE_LABELS.V,
          isCorrect: content.correctAnswer,
        },
        {
          key: TRUE_FALSE_KEYS.false,
          text: TRUE_FALSE_LABELS.F,
          isCorrect: !content.correctAnswer,
        },
      ];
    }
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
