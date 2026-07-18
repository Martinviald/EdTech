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
