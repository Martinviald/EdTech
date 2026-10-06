import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findProcessInvariantViolations,
  groupProcessCandidates,
  subjectTestKey,
  type ProcessCandidate,
} from './process-grouping';

type FixtureCandidate = ProcessCandidate & {
  ensayo: number | null;
  year: number;
  subjectCode: string | null;
  trackCode: string | null;
};

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../db/src/scripts/__fixtures__/process-candidates.json',
);

function loadFixture(): FixtureCandidate[] {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { candidates: FixtureCandidate[] };
  return raw.candidates;
}

const ORG = 'org-1';
const YEAR_2026 = 'ay-2026';
const YEAR_2025 = 'ay-2025';

function candidate(overrides: Partial<ProcessCandidate>): ProcessCandidate {
  return {
    assessmentId: 'a-1',
    orgId: ORG,
    academicYearId: YEAR_2026,
    instrumentId: 'i-1',
    instrumentType: 'dia',
    applicationPeriod: 'intermedio',
    gradeId: 'g-4b',
    subjectId: 'lang',
    trackId: null,
    ...overrides,
  };
}

describe('groupProcessCandidates con el fixture del banco local', () => {
  const fixture = loadFixture();
  const grouping = groupProcessCandidates(fixture);

  it('el DIA Intermedio 2026 da un solo proceso con sus 41 evaluaciones', () => {
    const dia = grouping.groups.filter((g) => g.instrumentType === 'dia');
    expect(dia).toHaveLength(1);
    expect(dia[0]?.applicationPeriod).toBe('intermedio');
    expect(dia[0]?.assessmentIds).toHaveLength(41);
  });

  it('las PAES sin período quedan ambiguas y no se asignan', () => {
    const paesGroups = grouping.groups.filter((g) => g.instrumentType === 'paes');
    expect(paesGroups).toHaveLength(0);

    const paesAmbiguous = grouping.ambiguous.filter((g) => g.instrumentType === 'paes');
    expect(paesAmbiguous).toHaveLength(1);
    expect(paesAmbiguous[0]?.assessmentIds).toHaveLength(68);
    expect(paesAmbiguous[0]?.violations.length).toBeGreaterThan(0);
    const inConflict = new Set(paesAmbiguous[0]?.violations.flatMap((v) => v.assessmentIds));
    expect(inConflict.size).toBe(68);
  });

  it('por tanda, con asignatura como prueba, solo chocan las asignaturas con varias líneas (M1/M2 y menciones de Ciencias)', () => {
    const paes = fixture.filter((c) => c.instrumentType === 'paes');
    const tandas = new Set(paes.map((c) => c.ensayo));
    expect(tandas.size).toBe(5);
    const subjectCodeById = new Map(paes.map((c) => [c.subjectId, c.subjectCode]));
    const multiTrackSubjects = new Set(['MATH', 'SCI']);
    const instrumentAsTrack = (c: FixtureCandidate) =>
      c.subjectCode && multiTrackSubjects.has(c.subjectCode) ? c.instrumentId : c.subjectId;
    for (const tanda of tandas) {
      const slice = paes.filter((c) => c.ensayo === tanda);
      const violations = findProcessInvariantViolations(slice, subjectTestKey);
      for (const violation of violations) {
        expect(multiTrackSubjects.has(subjectCodeById.get(violation.testKey) ?? '')).toBe(true);
      }
      expect(findProcessInvariantViolations(slice, instrumentAsTrack)).toEqual([]);
    }
  });

  it('por tanda, con la línea como prueba, M1 y M2 ya no chocan; solo Ciencias legacy', () => {
    const paes = fixture.filter((c) => c.instrumentType === 'paes');
    const subjectCodeById = new Map(paes.map((c) => [c.subjectId, c.subjectCode]));
    const tandasConM1yM2 = new Set<number | null>();
    for (const tanda of new Set(paes.map((c) => c.ensayo))) {
      const slice = paes.filter((c) => c.ensayo === tanda);
      const tracks = new Set(slice.map((c) => c.trackCode));
      if (tracks.has('M1') && tracks.has('M2')) tandasConM1yM2.add(tanda);
      for (const violation of findProcessInvariantViolations(slice)) {
        expect(subjectCodeById.get(violation.testKey)).toBe('SCI');
        expect(violation.instrumentIds).toHaveLength(3);
      }
    }
    expect([...tandasConM1yM2].sort()).toEqual([3, 4, 5]);
    const tandaE3 = paes.filter((c) => c.ensayo === 3 && c.subjectCode !== 'SCI');
    expect(new Set(tandaE3.map((c) => c.subjectCode))).toEqual(new Set(['LANG', 'MATH', 'HIST']));
    expect(findProcessInvariantViolations(tandaE3)).toEqual([]);
  });

  it('no deja evaluaciones fuera: asignadas + ambiguas suman el total', () => {
    const assigned = grouping.groups.reduce((sum, g) => sum + g.assessmentIds.length, 0);
    const ambiguous = grouping.ambiguous.reduce((sum, g) => sum + g.assessmentIds.length, 0);
    expect(assigned + ambiguous + grouping.multiYearAssessmentIds.length).toBe(
      new Set(fixture.map((c) => c.assessmentId)).size,
    );
  });
});

describe('groupProcessCandidates con casos sintéticos', () => {
  it('un recuperativo del MISMO instrumento no viola la invariante', () => {
    const result = groupProcessCandidates([
      candidate({ assessmentId: 'a-1' }),
      candidate({ assessmentId: 'a-2' }),
    ]);
    expect(result.ambiguous).toEqual([]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.assessmentIds).toEqual(['a-1', 'a-2']);
  });

  it('dos instrumentos distintos para el mismo nivel y asignatura apartan solo esa celda', () => {
    const result = groupProcessCandidates([
      candidate({ assessmentId: 'a-1', instrumentId: 'i-1' }),
      candidate({ assessmentId: 'a-2', instrumentId: 'i-2' }),
      candidate({ assessmentId: 'a-3', instrumentId: 'i-3', subjectId: 'math' }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.assessmentIds).toEqual(['a-3']);
    expect(result.groups[0]?.candidates.map((c) => c.assessmentId)).toEqual(['a-3']);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]?.assessmentIds).toEqual(['a-1', 'a-2']);
    expect(result.ambiguous[0]?.violations).toEqual([
      {
        gradeId: 'g-4b',
        testKey: 'lang',
        instrumentIds: ['i-1', 'i-2'],
        assessmentIds: ['a-1', 'a-2'],
      },
    ]);
  });

  it('un período DIA con un par hermano sin línea en un grado crea el proceso con el resto', () => {
    const result = groupProcessCandidates([
      candidate({ assessmentId: 'lang-4a', instrumentId: 'i-lang-4' }),
      candidate({ assessmentId: 'math-4a', instrumentId: 'i-math-4', subjectId: 'math' }),
      candidate({
        assessmentId: 'eng-5a',
        instrumentId: 'i-eng-5',
        gradeId: 'g-5b',
        subjectId: 'eng',
      }),
      candidate({
        assessmentId: 'speak-5a',
        instrumentId: 'i-speak-5',
        gradeId: 'g-5b',
        subjectId: 'eng',
      }),
      candidate({ assessmentId: 'lang-5a', instrumentId: 'i-lang-5', gradeId: 'g-5b' }),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.applicationPeriod).toBe('intermedio');
    expect([...(result.groups[0]?.assessmentIds ?? [])].sort()).toEqual([
      'lang-4a',
      'lang-5a',
      'math-4a',
    ]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]?.key).toBe(result.groups[0]?.key);
    expect(result.ambiguous[0]?.assessmentIds).toEqual(['eng-5a', 'speak-5a']);
    expect(result.ambiguous[0]?.violations).toEqual([
      {
        gradeId: 'g-5b',
        testKey: 'eng',
        instrumentIds: ['i-eng-5', 'i-speak-5'],
        assessmentIds: ['eng-5a', 'speak-5a'],
      },
    ]);
  });

  it('una evaluación con un curso en una celda en conflicto queda apartada entera', () => {
    const result = groupProcessCandidates([
      candidate({ assessmentId: 'a-1', instrumentId: 'i-1' }),
      candidate({ assessmentId: 'a-1', instrumentId: 'i-1', gradeId: 'g-5b' }),
      candidate({ assessmentId: 'a-2', instrumentId: 'i-2', gradeId: 'g-5b' }),
      candidate({ assessmentId: 'a-3', instrumentId: 'i-3', subjectId: 'math' }),
    ]);
    expect(result.groups[0]?.assessmentIds).toEqual(['a-3']);
    expect(result.ambiguous[0]?.assessmentIds).toEqual(['a-1', 'a-2']);
    expect(result.ambiguous[0]?.candidates).toHaveLength(3);
  });

  it('instrumentos distintos en niveles o asignaturas distintos sí conviven', () => {
    const result = groupProcessCandidates([
      candidate({ assessmentId: 'a-1', instrumentId: 'i-1' }),
      candidate({ assessmentId: 'a-2', instrumentId: 'i-2', gradeId: 'g-5b' }),
      candidate({ assessmentId: 'a-3', instrumentId: 'i-3', subjectId: 'math' }),
    ]);
    expect(result.ambiguous).toEqual([]);
    expect(result.groups[0]?.assessmentIds).toHaveLength(3);
  });

  it('separa por año, tipo y período', () => {
    const result = groupProcessCandidates([
      candidate({ assessmentId: 'a-1' }),
      candidate({ assessmentId: 'a-2', applicationPeriod: 'cierre', instrumentId: 'i-2' }),
      candidate({ assessmentId: 'a-3', academicYearId: YEAR_2025, instrumentId: 'i-3' }),
    ]);
    expect(result.groups).toHaveLength(3);
    expect(result.ambiguous).toEqual([]);
  });

  it('excluye la evaluación con cursos de más de un año académico', () => {
    const result = groupProcessCandidates([
      candidate({ assessmentId: 'a-1' }),
      candidate({ assessmentId: 'a-1', academicYearId: YEAR_2025 }),
      candidate({ assessmentId: 'a-2' }),
    ]);
    expect(result.multiYearAssessmentIds).toEqual(['a-1']);
    expect(result.groups[0]?.assessmentIds).toEqual(['a-2']);
  });

  it('por defecto la prueba es la línea: M1 y M2 de la misma asignatura conviven', () => {
    const rows = [
      candidate({ assessmentId: 'a-1', instrumentId: 'i-1', subjectId: 'math', trackId: 't-m1' }),
      candidate({ assessmentId: 'a-2', instrumentId: 'i-2', subjectId: 'math', trackId: 't-m2' }),
    ];
    const result = groupProcessCandidates(rows);
    expect(result.ambiguous).toEqual([]);
    expect(result.groups[0]?.assessmentIds).toEqual(['a-1', 'a-2']);
    expect(groupProcessCandidates(rows, { testKey: subjectTestKey }).ambiguous).toHaveLength(1);
  });

  it('dos instrumentos distintos de la MISMA línea siguen violando la invariante', () => {
    const result = groupProcessCandidates([
      candidate({ assessmentId: 'a-1', instrumentId: 'i-1', subjectId: 'math', trackId: 't-m1' }),
      candidate({ assessmentId: 'a-2', instrumentId: 'i-2', subjectId: 'math', trackId: 't-m1' }),
    ]);
    expect(result.ambiguous[0]?.violations[0]?.testKey).toBe('track:t-m1');
  });

  it('acepta una clave de prueba inyectada', () => {
    const tracks: Record<string, string> = { 'i-1': 'M1', 'i-2': 'M2' };
    const rows = [
      candidate({ assessmentId: 'a-1', instrumentId: 'i-1', subjectId: 'math' }),
      candidate({ assessmentId: 'a-2', instrumentId: 'i-2', subjectId: 'math' }),
    ];
    expect(groupProcessCandidates(rows).ambiguous).toHaveLength(1);
    const byTrack = groupProcessCandidates(rows, {
      testKey: (c) => tracks[c.instrumentId] ?? c.subjectId,
    });
    expect(byTrack.ambiguous).toEqual([]);
    expect(byTrack.groups).toHaveLength(1);
  });
});
