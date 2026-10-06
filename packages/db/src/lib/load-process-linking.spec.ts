import {
  groupByLoadProcessTarget,
  resolveLoadProcessTarget,
  splitLinkableByInvariant,
  type LoadProcessCandidate,
} from './load-process-linking';
import { buildConfigProcessName } from './config-process-grouping';

const ENSAYO = { by: 'config', key: 'ensayo' } as const;
const PERIODO = { by: 'period' } as const;

function candidate(overrides: Partial<LoadProcessCandidate>): LoadProcessCandidate {
  return {
    assessmentId: 'a1',
    orgId: 'org-1',
    academicYearId: 'year-2026',
    instrumentId: 'm1-e3',
    instrumentType: 'paes',
    applicationPeriod: null,
    gradeId: 'g-iv',
    subjectId: 's-math',
    trackId: 't-m1',
    year: 2026,
    classGroupId: 'cg-a',
    configValue: '3',
    administeredOn: '2026-06-10',
    taxonomyId: 'tax-paes',
    ...overrides,
  };
}

describe('resolveLoadProcessTarget', () => {
  it('un ensayo PAES va al proceso de su tanda, con el mismo nombre que el backfill', () => {
    const target = resolveLoadProcessTarget(candidate({}), ENSAYO);
    expect(target).toEqual({
      orgId: 'org-1',
      academicYearId: 'year-2026',
      name: 'Ensayo PAES 3 2026',
      slug: 'ensayo-paes-3-2026',
      kind: 'paes_ensayo',
      period: null,
    });
    expect(target?.name).toBe(buildConfigProcessName('paes', '3', 2026));
  });

  it('sin valor de tanda no hay destino', () => {
    expect(resolveLoadProcessTarget(candidate({ configValue: null }), ENSAYO)).toBeNull();
    expect(resolveLoadProcessTarget(candidate({ configValue: '  ' }), ENSAYO)).toBeNull();
  });

  it('un DIA va al proceso de su período', () => {
    const target = resolveLoadProcessTarget(
      candidate({ instrumentType: 'dia', applicationPeriod: 'intermedio', configValue: null }),
      PERIODO,
    );
    expect(target?.name).toBe('DIA Monitoreo 2026');
    expect(target?.slug).toBe('dia-monitoreo-2026');
    expect(target?.kind).toBe('dia');
    expect(target?.period).toBe('intermedio');
  });
});

describe('groupByLoadProcessTarget', () => {
  it('separa las tandas de un mismo lote', () => {
    const { groups, withoutTarget } = groupByLoadProcessTarget(
      [
        candidate({ assessmentId: 'e3-a' }),
        candidate({ assessmentId: 'e4-a', instrumentId: 'm1-e4', configValue: '4' }),
        candidate({ assessmentId: 'e3-b', classGroupId: 'cg-b' }),
      ],
      ENSAYO,
    );
    expect(withoutTarget).toEqual([]);
    expect(groups.map((g) => [g.target.slug, g.candidates.map((c) => c.assessmentId)])).toEqual([
      ['ensayo-paes-3-2026', ['e3-a', 'e3-b']],
      ['ensayo-paes-4-2026', ['e4-a']],
    ]);
  });

  it('deja sin destino la evaluación sin tanda o con cursos de dos años', () => {
    const { groups, withoutTarget } = groupByLoadProcessTarget(
      [
        candidate({ assessmentId: 'sin-tanda', configValue: null }),
        candidate({ assessmentId: 'dos-anios' }),
        candidate({
          assessmentId: 'dos-anios',
          academicYearId: 'year-2025',
          year: 2025,
          classGroupId: 'cg-2025',
        }),
        candidate({ assessmentId: 'ok' }),
      ],
      ENSAYO,
    );
    expect(withoutTarget).toEqual(['dos-anios', 'sin-tanda']);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.candidates.map((c) => c.assessmentId)).toEqual(['ok']);
  });
});

describe('splitLinkableByInvariant', () => {
  it('M2 se suma a la tanda que ya tiene M1: son líneas distintas', () => {
    const split = splitLinkableByInvariant(
      [candidate({ assessmentId: 'm2', instrumentId: 'm2-e3', trackId: 't-m2' })],
      [candidate({ assessmentId: 'm1' })],
    );
    expect(split).toEqual({ linkable: ['m2'], blocked: [], violations: [] });
  });

  it('una recarga del mismo instrumento cae en el proceso existente', () => {
    const split = splitLinkableByInvariant(
      [candidate({ assessmentId: 'm1-recarga' })],
      [candidate({ assessmentId: 'm1-b', classGroupId: 'cg-b' })],
    );
    expect(split.linkable).toEqual(['m1-recarga']);
  });

  it('bloquea otro instrumento de la misma línea y grado, pero vincula el resto del lote', () => {
    const split = splitLinkableByInvariant(
      [
        candidate({ assessmentId: 'm1-otra-tanda', instrumentId: 'm1-e4' }),
        candidate({
          assessmentId: 'cl',
          instrumentId: 'cl-e3',
          subjectId: 's-lang',
          trackId: null,
        }),
      ],
      [candidate({ assessmentId: 'm1' })],
    );
    expect(split.linkable).toEqual(['cl']);
    expect(split.blocked).toEqual(['m1-otra-tanda']);
    expect(split.violations[0]?.instrumentIds).toEqual(['m1-e3', 'm1-e4']);
  });

  it('sin línea, tres menciones de Ciencias del mismo grado quedan todas fuera', () => {
    const sci = (id: string) =>
      candidate({ assessmentId: id, instrumentId: id, subjectId: 's-sci', trackId: null });
    const split = splitLinkableByInvariant([sci('bio'), sci('fis'), sci('qui')], []);
    expect(split.linkable).toEqual([]);
    expect(split.blocked).toEqual(['bio', 'fis', 'qui']);
  });

  it('Ciencias fusionada (una línea CIE-COMUN) se vincula', () => {
    const split = splitLinkableByInvariant(
      [
        candidate({
          assessmentId: 'cie-a',
          instrumentId: 'cie-e3',
          subjectId: 's-sci',
          trackId: 't-comun',
        }),
        candidate({
          assessmentId: 'cie-b',
          instrumentId: 'cie-e3',
          subjectId: 's-sci',
          trackId: 't-comun',
          classGroupId: 'cg-b',
        }),
      ],
      [candidate({ assessmentId: 'm1' })],
    );
    expect(split.linkable).toEqual(['cie-a', 'cie-b']);
  });
});
