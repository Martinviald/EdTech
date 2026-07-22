/**
 * Lectura del read-model de cohorte por habilidad (`assessment_skill_stats`).
 *
 * Ver docs/plan-analitica-agregada-informes-oficiales.md §3.2, §5 y Fase 5.
 *
 * El read-model tiene grano `(assessment_id, class_group_id, node_id)`. Los dashboards
 * de habilidades y el heatmap agregan sobre un scope que puede abarcar VARIOS cursos y
 * VARIAS evaluaciones, así que necesitan recombinar filas. Recombinar mal es la forma
 * más fácil de mover números que hoy el usuario ya ve publicados, y por eso la
 * aritmética vive UNA sola vez acá (CLAUDE.md §4.2) y no copiada en cada service.
 *
 * ── Por qué se pondera por `studentCount` ────────────────────────────────────────
 * Antes ambos lectores hacían `avg(skill_results.percentage)` sobre las filas POR
 * ALUMNO, o sea Σ_alumnos pct / N. `assessment_skill_stats.percentage` con
 * `source='computed'` es, por decisión §9.2 del plan, exactamente la media de esos
 * mismos porcentajes por alumno dentro de un curso. Entonces:
 *
 *   Σ_alumnos pct / N  =  Σ_curso (pct_curso × n_curso) / Σ_curso n_curso
 *
 * Un promedio SIMPLE de los `percentage` de cada curso NO es equivalente: daría
 * distinto en cuanto dos cursos del scope tengan distinto N. La ponderación por
 * `studentCount` es lo que hace la migración numéricamente neutra.
 *
 * `pctWeight` (no `studentCount` a secas) es el denominador porque `avg()` de Postgres
 * ignora las filas con `percentage IS NULL` en numerador Y denominador; el `filter`
 * replica ese comportamiento.
 *
 * ── Por qué `studentsAssessed` usa max y no sum ──────────────────────────────────
 * Ver `COHORT_STUDENTS_ASSESSED`.
 */
import { sql } from 'drizzle-orm';
import { assessmentSkillStats } from '@soe/db';

/**
 * Numerador del promedio ponderado: Σ (percentage × studentCount) sobre las filas con
 * `percentage` no nulo. Postgres devuelve `numeric` como string.
 */
export const COHORT_PCT_SUM = sql<string | null>`
  sum(${assessmentSkillStats.percentage}::numeric * ${assessmentSkillStats.studentCount})
    filter (where ${assessmentSkillStats.percentage} is not null)
`;

/**
 * Denominador del promedio ponderado: Σ studentCount sobre las MISMAS filas que el
 * numerador (las de `percentage` no nulo), para replicar `avg()`.
 */
export const COHORT_PCT_WEIGHT = sql<number>`
  coalesce(
    sum(${assessmentSkillStats.studentCount})
      filter (where ${assessmentSkillStats.percentage} is not null),
    0
  )::int
`;

/**
 * Alumnos evaluados de UN curso en el nodo.
 *
 * Es `max` y no `sum` porque el scope puede abarcar varias evaluaciones: el número que
 * los dashboards muestran hoy es `count(distinct student_id)`, y un alumno que rindió
 * dos evaluaciones cuenta UNA vez. Sumar `studentCount` a través de evaluaciones lo
 * contaría dos veces (43 alumnos × 2 evaluaciones = 86).
 *
 * ⚠️ Por eso este agregado SIEMPRE debe calcularse agrupando por curso y recombinarse
 * con `foldCohortRows` (que suma los max de cada curso). `max` sobre las evaluaciones
 * de un curso reproduce el conteo distinto exactamente cuando las cohortes evaluadas
 * de ese curso están anidadas entre evaluaciones — que es el caso real (mismo curso,
 * mismos alumnos, a lo más algún ausente). Puede quedarse corto sólo si dos
 * evaluaciones del mismo curso evaluaron alumnos disjuntos (ver informe de Fase 5).
 */
export const COHORT_STUDENTS_ASSESSED = sql<number>`max(${assessmentSkillStats.studentCount})::int`;

/**
 * Fila del read-model ya agregada en SQL al grano (dimensión × curso). La dimensión es
 * lo que el lector quiera (nodo, nodo×asignatura, evaluación, curso, nivel…), pero el
 * curso NO puede faltar del `group by`: es lo que hace correcto el `max` de
 * `COHORT_STUDENTS_ASSESSED`.
 */
export type CohortStatsRow = {
  pctSum: string | null;
  pctWeight: number;
  studentsAssessed: number;
};

/** Acumulado de una dimensión tras recombinar sus cursos. */
export type CohortAccumulator = {
  pctSum: number;
  pctWeight: number;
  studentsAssessed: number;
};

/**
 * Acumula una fila (dimensión × curso) en el agregado de su dimensión. Devuelve el
 * acumulador para que el caller pueda colgarle metadata (nombres, labels) la primera
 * vez que ve la clave.
 */
export function addCohortRow(
  acc: Map<string, CohortAccumulator>,
  key: string,
  row: CohortStatsRow,
): CohortAccumulator {
  let cur = acc.get(key);
  if (!cur) {
    cur = { pctSum: 0, pctWeight: 0, studentsAssessed: 0 };
    acc.set(key, cur);
  }
  cur.pctSum += row.pctSum == null ? 0 : Number(row.pctSum);
  cur.pctWeight += Number(row.pctWeight ?? 0);
  cur.studentsAssessed += Number(row.studentsAssessed ?? 0);
  return cur;
}

/**
 * % de logro de la dimensión (0..100), o null si ninguna fila aportó porcentaje —
 * mismo contrato que el `avg()` que devolvía NULL sobre un grupo sin datos.
 */
export function cohortAverage(acc: CohortAccumulator): number | null {
  return acc.pctWeight > 0 ? acc.pctSum / acc.pctWeight : null;
}
