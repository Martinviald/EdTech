/**
 * Escritura del read-model de cohorte (`assessment_item_stats` / `assessment_skill_stats`).
 *
 * Ver docs/plan-analitica-agregada-informes-oficiales.md §3 y §5.
 *
 * Vive en `packages/db/queries` y no en `apps/api` porque tiene TRES consumidores que
 * no comparten proceso: los dos escritores de la API (`assessment-results` y
 * `answer-sheets`, vía `lib/persist-results.ts`), el backfill CLI
 * (`src/scripts/backfill-cohort-stats.ts`) y —en Fase 4— el importador de informes
 * oficiales. La agregación en sí no está acá: es pura y vive en
 * `@soe/types/utils/item-stats-calculator`.
 *
 * ⚠️ Todas estas funciones asumen que `tx` corre dentro de `withOrgContext` (CLAUDE.md
 * §5.2). Ambas tablas tienen RLS por `EXISTS` sobre `assessments.org_id`: sin contexto
 * los DELETE no borran nada y los INSERT fallan.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  aggregateCohortSkillStats,
  aggregateItemStats,
  type ItemCohortStats,
  type ResponseForItemStats,
  type SkillCohortStats,
  type SkillResultForCohort,
} from '@soe/types';
import type { Database } from '../client';
import { classGroups } from '../schema/academic';
import { assessmentCourseAssignments, assessments } from '../schema/assessments';
import type { statsSourceEnum } from '../schema/enums';
import { academicYears } from '../schema/organizations';
import { assessmentItemStats, assessmentSkillStats } from '../schema/results';
import { studentEnrollments, students } from '../schema/students';

export type StatsSource = (typeof statsSourceEnum.enumValues)[number];

/** Postgres topa en 65535 parámetros por statement; `assessment_item_stats` usa ~11 por fila. */
const INSERT_CHUNK = 500;

/**
 * Mapa alumno → curso para bucketizar la cohorte.
 *
 * La fuente de la pertenencia es SIEMPRE `student_enrollments`, nunca
 * `assessment_course_assignments`: es el camino que usa `resolveAccessibleStudentIds`
 * para resolver el scope de un rol, y derivar el bucket de otra tabla movería alumnos
 * de curso (plan §2.4). `assessment_course_assignments` entra sólo a DESEMPATAR entre
 * varias matrículas, que es exactamente lo que hace `loadStudentClassGroups`
 * (item-analysis.service.ts) para pintar el curso del alumno en la matriz.
 *
 * Resolución en dos pasadas, y las dos hacen falta:
 *  1. Matrícula en un curso ASIGNADO a la evaluación. Desempata al alumno con
 *     matrícula en varios años (`student_enrollments` es único por (alumno, año), no
 *     por alumno) y lo deja en el mismo curso que ya muestra la UI. Orden por nombre
 *     de curso, igual que `loadStudentClassGroups`, para que el desempate sea estable.
 *  2. Fallback por alumno: cualquier matrícula, la del año más reciente.
 *
 * La pasada 2 NO es decorativa: `AnswerSheetsService.confirm` crea la evaluación SIN
 * filas en `assessment_course_assignments`. Restringir sólo por (1) dejaría el
 * read-model VACÍO justo para la ingesta de hojas de respuesta — el modo de falla
 * "desincronizado y silenciosamente falso" que este refactor viene a matar. Al ser por
 * alumno y no global, sólo suma cobertura: nunca mueve de bucket a quien (1) resolvió.
 *
 * ⚠️ SOFT DELETE — se EXCLUYEN (`deleted_at IS NULL`). Hoy los lectores se contradicen:
 * `attachCorrectRates` cuenta a los alumnos borrados cuando no hay filtro de curso y
 * los excluye cuando sí lo hay; heatmap y dashboards los excluyen siempre. Las dos
 * semánticas no caben en un read-model pre-agregado por curso: hay que elegir un lado
 * al ESCRIBIR, y es acá donde se elige POR TODOS los lectores.
 *
 * Se excluyen porque CLAUDE.md §5.1 lo dice explícitamente ("las queries deben filtrar
 * WHERE deleted_at IS NULL por defecto") y porque el soft delete de alumnos existe por
 * la Ley 19.628: un alumno borrado no debe influir en ningún número mostrado. El costo
 * es que el % org-wide de `attachCorrectRates` deja de contarlos — lo que era el bug,
 * no la referencia a preservar. Medido en la BDD real: 0 alumnos soft-deleted con
 * respuestas, así que hoy no se mueve ningún número.
 *
 * ⚠️ El innerJoin a `students` no es decorativo aunque no filtre nada: `students` tiene
 * RLS y `student_enrollments` no, así que es lo que aísla el tenant en esta query.
 */
/**
 * Año lectivo de referencia de una evaluación: el de su aplicación, o el de su
 * creación si nunca se aplicó. `assessments` no tiene `academic_year_id`, así que se
 * deriva de la fecha; es la única señal disponible.
 */
async function resolveAssessmentYear(tx: Database, assessmentId: string): Promise<number | null> {
  const rows = await tx
    .select({
      year: sql<
        number | null
      >`extract(year from coalesce(${assessments.administeredAt}, ${assessments.createdAt}))::int`,
    })
    .from(assessments)
    .where(eq(assessments.id, assessmentId))
    .limit(1);
  return rows[0]?.year ?? null;
}

export async function loadEnrollmentByStudent(
  tx: Database,
  assessmentId: string,
  studentIds: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (studentIds.length === 0) return map;

  const ids = [...studentIds];

  // Pasada 1 — matrícula en un curso asignado a la evaluación.
  const assigned = await tx
    .select({
      studentId: studentEnrollments.studentId,
      classGroupId: classGroups.id,
    })
    .from(studentEnrollments)
    .innerJoin(students, eq(students.id, studentEnrollments.studentId))
    .innerJoin(classGroups, eq(classGroups.id, studentEnrollments.classGroupId))
    .innerJoin(
      assessmentCourseAssignments,
      and(
        eq(assessmentCourseAssignments.classGroupId, classGroups.id),
        eq(assessmentCourseAssignments.assessmentId, assessmentId),
      ),
    )
    .where(and(inArray(studentEnrollments.studentId, ids), isNull(students.deletedAt)))
    .orderBy(asc(studentEnrollments.studentId), asc(classGroups.name));

  for (const r of assigned) {
    if (!map.has(r.studentId)) map.set(r.studentId, r.classGroupId);
  }

  const unresolved = ids.filter((id) => !map.has(id));
  if (unresolved.length === 0) return map;

  // Pasada 2 — cualquier matrícula, la del año MÁS CERCANO al de la evaluación.
  //
  // Anclar al año de la evaluación y no al más reciente es lo que evita que, al
  // renovar la matrícula, las filas de una evaluación de 2025 queden etiquetadas con
  // el curso de 2026: un dashboard filtrado por 2025 dejaría de encontrarlas y los
  // resultados desaparecerían en silencio. El caso NO es teórico — `answer-sheets`
  // crea el assessment sin `assessment_course_assignments`, así que la pasada 1
  // siempre falla ahí y toda la ingesta de hojas depende de esta pasada.
  const targetYear = await resolveAssessmentYear(tx, assessmentId);
  const yearProximity =
    targetYear == null ? sql`0` : sql`abs(${academicYears.year} - ${targetYear})`;

  const fallback = await tx
    .select({
      studentId: studentEnrollments.studentId,
      classGroupId: studentEnrollments.classGroupId,
    })
    .from(studentEnrollments)
    .innerJoin(students, eq(students.id, studentEnrollments.studentId))
    .innerJoin(academicYears, eq(academicYears.id, studentEnrollments.academicYearId))
    .where(and(inArray(studentEnrollments.studentId, unresolved), isNull(students.deletedAt)))
    .orderBy(asc(yearProximity), asc(academicYears.year));

  for (const r of fallback) {
    if (!map.has(r.studentId)) map.set(r.studentId, r.classGroupId);
  }

  return map;
}

/**
 * Reemplaza el read-model de un assessment (delete + reinsert), igual que el recálculo
 * de `assessment_results` / `skill_results`: las tablas no tienen `deleted_at` y el
 * recálculo debe ser idempotente.
 */
export async function replaceCohortStats(
  tx: Database,
  assessmentId: string,
  source: StatsSource,
  itemStats: readonly ItemCohortStats[],
  skillStats: readonly SkillCohortStats[],
): Promise<{ itemRows: number; skillRows: number }> {
  const now = new Date();

  await tx.delete(assessmentItemStats).where(eq(assessmentItemStats.assessmentId, assessmentId));
  await tx.delete(assessmentSkillStats).where(eq(assessmentSkillStats.assessmentId, assessmentId));

  const itemValues = itemStats.map((s) => ({
    assessmentId,
    classGroupId: s.classGroupId,
    itemId: s.itemId,
    studentCount: s.studentCount,
    responseCount: s.responseCount,
    correctCount: s.correctCount,
    answerCounts: s.answerCounts,
    scoreSum: s.scoreSum.toFixed(2),
    maxSum: s.maxSum.toFixed(2),
    source,
    computedAt: now,
  }));
  for (const chunk of chunked(itemValues)) {
    await tx.insert(assessmentItemStats).values(chunk);
  }

  const skillValues = skillStats.map((s) => ({
    assessmentId,
    classGroupId: s.classGroupId,
    nodeId: s.nodeId,
    studentCount: s.studentCount,
    correctCount: s.correctCount,
    totalCount: s.totalCount,
    // El calculador puro trabaja en 0..1; la columna es 0..100, como el resto de los
    // `percentage` del esquema (assessment_results, skill_results).
    percentage: s.percentage === null ? null : (s.percentage * 100).toFixed(2),
    source,
    computedAt: now,
  }));
  for (const chunk of chunked(skillValues)) {
    await tx.insert(assessmentSkillStats).values(chunk);
  }

  return { itemRows: itemValues.length, skillRows: skillValues.length };
}

export type RecomputeCohortStatsInput = {
  assessmentId: string;
  /** TODAS las respuestas del assessment, con el JSONB `value` crudo. */
  responses: readonly ResponseForItemStats[];
  /** `skill_results` por alumno recién calculados. `percentage` en 0..1. */
  skillResults: readonly SkillResultForCohort[];
};

/**
 * Recalcula y persiste el read-model de un assessment desde sus respuestas
 * (`source='computed'`).
 *
 * ⚠️ `responses` debe traer TODAS las filas del assessment, incluidas las pendientes de
 * corrección (`isCorrect === null`). El read-model espeja el `GROUP BY` que hoy hace
 * `item-analysis` sobre `responses`, y ese GROUP BY no filtra nada: `responseCount` es
 * `count(*)` e incluye blancos y pendientes. Pasar un subconjunto filtrado rompería la
 * paridad que la Fase 2 va a verificar fila a fila.
 *
 * `orphanResponses` cuenta las respuestas de alumnos que no cayeron en ninguna cohorte
 * (sin matrícula). El calculador las descarta porque el grano exige un `class_group_id`
 * NOT NULL. Se devuelve para que sea MEDIBLE: cualquier valor > 0 es una diferencia
 * org-wide contra el `GROUP BY` actual, y hay que verla antes de que la Fase 2 mueva
 * los lectores al read-model.
 */
export async function recomputeCohortStatsFromResponses(
  tx: Database,
  input: RecomputeCohortStatsInput,
): Promise<{ itemRows: number; skillRows: number; orphanResponses: number }> {
  const studentIds = new Set<string>();
  for (const r of input.responses) studentIds.add(r.studentId);
  for (const s of input.skillResults) studentIds.add(s.studentId);

  const enrollment = await loadEnrollmentByStudent(tx, input.assessmentId, [...studentIds]);

  const orphanResponses = input.responses.reduce(
    (n, r) => (enrollment.has(r.studentId) ? n : n + 1),
    0,
  );

  const written = await replaceCohortStats(
    tx,
    input.assessmentId,
    'computed',
    aggregateItemStats(input.responses, enrollment),
    aggregateCohortSkillStats(input.skillResults, enrollment),
  );

  return { ...written, orphanResponses };
}

function chunked<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    out.push(rows.slice(i, i + INSERT_CHUNK));
  }
  return out;
}
