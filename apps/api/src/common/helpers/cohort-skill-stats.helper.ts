import { sql } from 'drizzle-orm';
import { assessmentSkillStats } from '@soe/db';
import { achievementPct, addTally, emptyTally, tallyOf, type AchievementTally } from '@soe/types';

export const COHORT_SCORE_SUM = sql<string>`coalesce(sum(${assessmentSkillStats.scoreSum}), 0)`;

export const COHORT_MAX_SUM = sql<string>`coalesce(sum(${assessmentSkillStats.maxSum}), 0)`;

export const COHORT_STUDENTS_ASSESSED = sql<number>`max(${assessmentSkillStats.studentCount})::int`;

export type CohortStatsRow = {
  scoreSum: string | null;
  maxSum: string | null;
  studentsAssessed: number;
};

export type CohortAccumulator = {
  tally: AchievementTally;
  studentsAssessed: number;
};

export function addCohortRow(
  acc: Map<string, CohortAccumulator>,
  key: string,
  row: CohortStatsRow,
): CohortAccumulator {
  let cur = acc.get(key);
  if (!cur) {
    cur = { tally: emptyTally(), studentsAssessed: 0 };
    acc.set(key, cur);
  }
  addTally(cur.tally, tallyOf([row]));
  cur.studentsAssessed += Number(row.studentsAssessed ?? 0);
  return cur;
}

export function cohortAverage(acc: CohortAccumulator): number | null {
  return achievementPct(acc.tally);
}
