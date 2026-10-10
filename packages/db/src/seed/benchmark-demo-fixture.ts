/**
 * Piezas del fixture de benchmarking (`benchmark-demo.ts`) que también usa el script que
 * rellena el tally de ese fixture en una BDD ya sembrada (`backfill-benchmark-demo-tallies.ts`).
 * Viven aparte porque `benchmark-demo.ts` corre el seed al importarlo.
 */
import type { BenchmarkSkillAggregate } from '@soe/types';

export const DEMO_INST_LECT_ID = 'b3c00000-0000-0000-0000-000000000101';
export const DEMO_INST_MAT_ID = 'b3c00000-0000-0000-0000-000000000102';
export const DEMO_INSTRUMENT_IDS = [DEMO_INST_LECT_ID, DEMO_INST_MAT_ID] as const;

/** Puntos por alumno con que se fabrica el tally de los fixtures (sólo escala). */
const DEMO_SKILL_POINTS_PER_STUDENT = 4;
const DEMO_INSTRUMENT_POINTS_PER_STUDENT = 30;

export type DemoTally = { scoreSum: number; maxSum: number };

/** Tally de un fixture con `studentCount` alumnos y `achievement` % de logro (0..100). */
function demoTally(studentCount: number, achievement: number, pointsPerStudent: number): DemoTally {
  const maxSum = studentCount * pointsPerStudent;
  return { scoreSum: Math.round(maxSum * achievement) / 100, maxSum };
}

export function demoInstrumentTally(studentCount: number, achievement: number): DemoTally {
  return demoTally(studentCount, achievement, DEMO_INSTRUMENT_POINTS_PER_STUDENT);
}

export function demoSkillTally(studentCount: number, achievement: number): DemoTally {
  return demoTally(studentCount, achievement, DEMO_SKILL_POINTS_PER_STUDENT);
}

/** Completa el tally de una habilidad del fixture que no lo tiene (sembrada antes del tally). */
export function withDemoSkillTally(skill: BenchmarkSkillAggregate): BenchmarkSkillAggregate {
  if (Number(skill.maxSum) > 0 || skill.achievement === null) return skill;
  return { ...skill, ...demoSkillTally(skill.studentCount, skill.achievement) };
}
