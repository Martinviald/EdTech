import type { Database } from '../../database/database.types';
import { loadCohortOverallAchievement } from './cohort-item-stats.helper';

// Mock encadenable: select().from().where().groupBy() resuelve a `rows` al hacer await.
function makeDb(rows: unknown[]): Database {
  const chain = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    then: <T>(resolve: (r: T[]) => unknown) =>
      Promise.resolve(rows as never).then(resolve as never),
  };
  return { select: () => chain } as unknown as Database;
}

const ASSESSMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('loadCohortOverallAchievement', () => {
  it('logro global = Σ score_sum / Σ max_sum, ponderado por puntaje entre cursos', async () => {
    // Dos cursos: (45/60) y (30/60) → global 75/120 = 62.5%, NO el promedio simple de
    // 75% y 50% (68.75%). La ponderación por puntaje es lo que reproduce el logro DIA.
    const db = makeDb([
      { scoreSum: '45.00', maxSum: '60.00', studentsAssessed: 30 },
      { scoreSum: '30.00', maxSum: '60.00', studentsAssessed: 28 },
    ]);
    const res = await loadCohortOverallAchievement(db, ASSESSMENT_ID, null);
    expect(res.averageAchievement).toBeCloseTo(62.5);
    // N de la cohorte: suma del max(student_count) por curso (no un max global).
    expect(res.studentsAssessed).toBe(58);
  });

  it('sin filas → logro null y N 0 (no divide por cero)', async () => {
    const res = await loadCohortOverallAchievement(makeDb([]), ASSESSMENT_ID, null);
    expect(res.averageAchievement).toBeNull();
    expect(res.studentsAssessed).toBe(0);
  });

  it('maxSum 0 → logro null (safe default), sin tocar la BD con filtro de cursos vacío', async () => {
    // Filtro de cursos vacío: no accede a datos (scope sin cursos accesibles).
    const empty = await loadCohortOverallAchievement(
      makeDb([{ scoreSum: '0', maxSum: '0', studentsAssessed: 3 }]),
      ASSESSMENT_ID,
      [],
    );
    expect(empty.averageAchievement).toBeNull();
    expect(empty.studentsAssessed).toBe(0);
  });
});
