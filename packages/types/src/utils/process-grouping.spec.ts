import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  findProcessInvariantViolations,
  groupProcessCandidates,
  type ProcessCandidate,
} from './process-grouping';

type FixtureCandidate = ProcessCandidate & {
  ensayo: number | null;
  year: number;
  subjectCode: string | null;
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
      const violations = findProcessInvariantViolations(slice);
      for (const violation of violations) {
        expect(multiTrackSubjects.has(subjectCodeById.get(violation.testKey) ?? '')).toBe(true);
      }
      expect(findProcessInvariantViolations(slice, instrumentAsTrack)).toEqual([]);
    }
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

  it('dos instrumentos distintos para el mismo nivel y asignatura dejan el grupo ambiguo', () => {
    const result = groupProcessCandidates([
      candidate({ assessmentId: 'a-1', instrumentId: 'i-1' }),
      candidate({ assessmentId: 'a-2', instrumentId: 'i-2' }),
      candidate({ assessmentId: 'a-3', instrumentId: 'i-3', subjectId: 'math' }),
    ]);
    expect(result.groups).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]?.violations).toEqual([
      {
        gradeId: 'g-4b',
        testKey: 'lang',
        instrumentIds: ['i-1', 'i-2'],
        assessmentIds: ['a-1', 'a-2'],
      },
    ]);
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
