/**
 * Filas de `assessment_results` y `skill_results` a partir de los agregados por alumno de
 * `@soe/types` (`aggregateStudentResults` / `aggregateSkillResults`).
 *
 * Un solo lugar para el contrato del modelo, que antes se repetía en la persistencia de la API y
 * en cada seed:
 *  · `percentage` en la BD es 0..100 (decimal string); el calculador puro trabaja en 0..1.
 *  · Sin preguntas corregidas no hay logro: `percentage`, `grade` y el nivel van `null`
 *    (docs/diseno-logro-unificado-y-cohorte.md §3.1).
 *  · `skill_results` guarda el tally del alumno en el nodo (`score_sum` / `max_sum`), que es lo
 *    que se suma para el % de cualquier grupo.
 */
import type {
  SkillAggregateResult,
  SkillResultForCohort,
  StudentAggregateResult,
} from '@soe/types';
import type { assessmentResults, skillResults } from '../schema/results';

type AssessmentResultInsert = typeof assessmentResults.$inferInsert;
type SkillResultInsert = typeof skillResults.$inferInsert;

function toPercentColumn(fraction: number | null): string | null {
  return fraction === null ? null : (fraction * 100).toFixed(2);
}

export function toAssessmentResultRow(
  assessmentId: string,
  a: StudentAggregateResult,
  completedAt: Date | null,
): AssessmentResultInsert {
  return {
    assessmentId,
    studentId: a.studentId,
    totalScore: a.totalScore.toFixed(2),
    maxScore: a.maxScore.toFixed(2),
    percentage: toPercentColumn(a.percentage),
    grade: a.grade === null ? null : a.grade.toFixed(2),
    performanceBandId: a.performanceBandId ?? null,
    performanceLevel: a.performanceLevel,
    isComplete: a.isComplete,
    completedAt,
  };
}

export function toSkillResultRow(assessmentId: string, a: SkillAggregateResult): SkillResultInsert {
  return {
    assessmentId,
    studentId: a.studentId,
    nodeId: a.nodeId,
    correctCount: a.correctCount,
    totalCount: a.totalCount,
    scoreSum: a.scoreSum.toFixed(2),
    maxSum: a.maxSum.toFixed(2),
    percentage: toPercentColumn(a.percentage),
    performanceBandId: a.performanceBandId ?? null,
    performanceLevel: a.performanceLevel,
  };
}

export function toSkillResultForCohort(a: SkillAggregateResult): SkillResultForCohort {
  return {
    studentId: a.studentId,
    nodeId: a.nodeId,
    correctCount: a.correctCount,
    totalCount: a.totalCount,
    scoreSum: a.scoreSum,
    maxSum: a.maxSum,
  };
}
