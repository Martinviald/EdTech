/**
 * Logro global de cohorte desde el read-model de ítems (`assessment_item_stats`).
 *
 * Hermano de `cohort-skill-stats.helper.ts`. Un informe oficial DIA cargado en modo
 * `aggregate_only` no tiene filas por alumno (`assessment_results.percentage` es null),
 * así que el "% de logro promedio del curso" no puede salir del promedio de porcentajes
 * por alumno. Sí sale del read-model de ítems: el logro del curso es
 *
 *   Σ score_sum / Σ max_sum
 *
 * es decir, la tasa ponderada por puntaje sobre TODOS los ítems (admite el crédito
 * parcial del DIA, RPC = 0.5). Para DIA —donde todos rinden los mismos ítems, mismo
 * `max_sum`— este número coincide con el promedio de los % por alumno, así que llenar
 * `summary.averageAchievement` con él no cambia la semántica del campo.
 *
 * ── Grano y recombinación ────────────────────────────────────────────────────────
 * `assessment_item_stats` tiene grano `(assessment_id, class_group_id, item_id)`. El
 * scope de lectura puede abarcar varios cursos. `score_sum`/`max_sum` son sumables sin
 * más (el ratio de las sumas es el logro global correcto), pero `studentsAssessed` NO:
 * dentro de un curso `student_count` es constante entre ítems, así que el N del curso es
 * su `max(student_count)`, y el N del scope es la SUMA de esos max por curso (mismo
 * argumento que `COHORT_STUDENTS_ASSESSED` del helper de habilidades). Por eso se agrupa
 * por curso en SQL y se recombina en JS.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { assessmentItemStats } from '@soe/db';
import type { Database } from '../../database/database.types';

export type CohortOverallAchievement = {
  /** % de logro global del scope (0..100), o null si no hay puntaje evaluado. */
  averageAchievement: number | null;
  /** N de la cohorte (Σ del max por curso). */
  studentsAssessed: number;
};

const EMPTY: CohortOverallAchievement = { averageAchievement: null, studentsAssessed: 0 };

/**
 * Lee el logro global de cohorte para una evaluación, opcionalmente acotado a un
 * conjunto de cursos. `classGroupFilter === null` significa "todos los cursos"
 * (scopeAll); `[]` significa "ningún curso accesible" → resultado vacío.
 *
 * Debe correr dentro de `withOrgContext` (el `tx` de la transacción): `assessment_item_stats`
 * tiene FORCE RLS vía `EXISTS` sobre `assessments`.
 */
export async function loadCohortOverallAchievement(
  db: Database,
  assessmentId: string,
  classGroupFilter: string[] | null,
): Promise<CohortOverallAchievement> {
  if (classGroupFilter !== null && classGroupFilter.length === 0) return EMPTY;

  const conditions = [eq(assessmentItemStats.assessmentId, assessmentId)];
  if (classGroupFilter !== null) {
    conditions.push(inArray(assessmentItemStats.classGroupId, classGroupFilter));
  }

  const rows = await db
    .select({
      scoreSum: sql<string | null>`sum(${assessmentItemStats.scoreSum}::numeric)`,
      maxSum: sql<string | null>`sum(${assessmentItemStats.maxSum}::numeric)`,
      studentsAssessed: sql<number>`max(${assessmentItemStats.studentCount})::int`,
    })
    .from(assessmentItemStats)
    .where(and(...conditions))
    .groupBy(assessmentItemStats.classGroupId);

  if (rows.length === 0) return EMPTY;

  let scoreSum = 0;
  let maxSum = 0;
  let studentsAssessed = 0;
  for (const r of rows) {
    scoreSum += r.scoreSum == null ? 0 : Number(r.scoreSum);
    maxSum += r.maxSum == null ? 0 : Number(r.maxSum);
    studentsAssessed += Number(r.studentsAssessed ?? 0);
  }

  return {
    averageAchievement: maxSum > 0 ? (scoreSum / maxSum) * 100 : null,
    studentsAssessed,
  };
}

/** Logro global de cohorte de UN assessment dentro de un scope de cursos. */
export type CohortAssessmentAchievement = {
  assessmentId: string;
} & CohortOverallAchievement;

/**
 * Igual que `loadCohortOverallAchievement` pero para VARIOS assessment de una vez,
 * devolviendo una fila por assessment presente en el read-model de ítems dentro del
 * scope. La usa `DashboardsService.getOverview` para (a) saber qué assessment tienen
 * datos de cohorte —y así contarlos aunque no tengan filas per-alumno en
 * `assessment_results`— y (b) obtener su logro y N de cohorte.
 *
 * El logro por assessment es Σ score_sum / Σ max_sum (ponderado por puntaje, admite
 * crédito parcial); el N es Σ del `max(student_count)` por curso (mismo argumento de N
 * que `COHORT_STUDENTS_ASSESSED`). Se agrupa por curso en SQL y se recombina en JS.
 *
 * `classGroupFilter === null` = todos los cursos (scopeAll); `[]` = ningún curso → [].
 * Debe correr dentro de `withOrgContext` (FORCE RLS vía EXISTS sobre `assessments`).
 */
export async function loadCohortAchievementByAssessment(
  db: Database,
  assessmentIds: string[],
  classGroupFilter: string[] | null,
): Promise<CohortAssessmentAchievement[]> {
  if (assessmentIds.length === 0) return [];
  if (classGroupFilter !== null && classGroupFilter.length === 0) return [];

  const conditions = [inArray(assessmentItemStats.assessmentId, assessmentIds)];
  if (classGroupFilter !== null) {
    conditions.push(inArray(assessmentItemStats.classGroupId, classGroupFilter));
  }

  const rows = await db
    .select({
      assessmentId: assessmentItemStats.assessmentId,
      scoreSum: sql<string | null>`sum(${assessmentItemStats.scoreSum}::numeric)`,
      maxSum: sql<string | null>`sum(${assessmentItemStats.maxSum}::numeric)`,
      studentsAssessed: sql<number>`max(${assessmentItemStats.studentCount})::int`,
    })
    .from(assessmentItemStats)
    .where(and(...conditions))
    .groupBy(assessmentItemStats.assessmentId, assessmentItemStats.classGroupId);

  // Recombina las filas (assessment × curso) en una fila por assessment: score_sum/
  // max_sum son sumables; el N del scope es la SUMA de los max(student_count) por curso.
  const acc = new Map<string, { score: number; max: number; students: number }>();
  for (const r of rows) {
    let cur = acc.get(r.assessmentId);
    if (!cur) {
      cur = { score: 0, max: 0, students: 0 };
      acc.set(r.assessmentId, cur);
    }
    cur.score += r.scoreSum == null ? 0 : Number(r.scoreSum);
    cur.max += r.maxSum == null ? 0 : Number(r.maxSum);
    cur.students += Number(r.studentsAssessed ?? 0);
  }

  return [...acc.entries()].map(([assessmentId, a]) => ({
    assessmentId,
    averageAchievement: a.max > 0 ? (a.score / a.max) * 100 : null,
    studentsAssessed: a.students,
  }));
}
