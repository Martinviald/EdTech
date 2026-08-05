// Arma las filas de `assessment_results` y `skill_results` a partir de las
// respuestas ya corregidas de un assessment.
//
// Lo comparten la ingesta y la re-corrección: son los mismos números publicados,
// y si cada una redondeara o marcara `isComplete` a su manera, re-corregir un
// assessment le movería los resultados sin que ninguna respuesta hubiera cambiado.

import type {
  ResponseForCalculation,
  ResponseForItemStats,
  GradingScaleParams,
  SkillResultForCohort,
} from '@soe/types';
import { aggregateStudentResults, aggregateSkillResults } from '@soe/types';
import type { assessmentResults, skillResults } from '../schema/results';

export type ScoredResponse = ResponseForCalculation & ResponseForItemStats;

export type AssessmentResultRows = {
  results: Array<typeof assessmentResults.$inferInsert>;
  skills: Array<typeof skillResults.$inferInsert>;
  cohortSkills: SkillResultForCohort[];
};

/**
 * Un alumno con alguna respuesta sin corregir NO queda `isComplete`: su puntaje
 * todavía puede subir cuando alguien corrija lo pendiente, y marcarlo completo
 * publicaría un total provisorio como definitivo.
 */
export function buildAssessmentResultRows(
  assessmentId: string,
  scored: ScoredResponse[],
  scale: GradingScaleParams,
  completedAt: Date,
): AssessmentResultRows {
  const graded = scored.filter((c) => c.isCorrect !== null);
  const withPending = new Set(scored.filter((c) => c.isCorrect === null).map((c) => c.studentId));

  const studentAgg = aggregateStudentResults(graded, scale);
  const skillAgg = aggregateSkillResults(scored, scale);

  return {
    results: studentAgg.map((a) => ({
      assessmentId,
      studentId: a.studentId,
      totalScore: a.totalScore.toFixed(2),
      maxScore: a.maxScore.toFixed(2),
      percentage: (a.percentage * 100).toFixed(2),
      grade: a.grade.toFixed(2),
      performanceLevel: a.performanceLevel,
      isComplete: a.isComplete && !withPending.has(a.studentId),
      completedAt,
    })),
    skills: skillAgg.map((a) => ({
      assessmentId,
      studentId: a.studentId,
      nodeId: a.nodeId,
      correctCount: a.correctCount,
      totalCount: a.totalCount,
      percentage: (a.percentage * 100).toFixed(2),
      performanceLevel: a.performanceLevel,
    })),
    cohortSkills: skillAgg.map((a) => ({
      studentId: a.studentId,
      nodeId: a.nodeId,
      correctCount: a.correctCount,
      totalCount: a.totalCount,
      percentage: a.percentage,
    })),
  };
}
