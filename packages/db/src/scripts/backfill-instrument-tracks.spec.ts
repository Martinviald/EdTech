import { indexTestTracksByCode } from '@soe/types';
import {
  parseTrackArgs,
  planTrackAssignments,
  type TrackTarget,
} from './backfill-instrument-tracks';

const ENG = 'subject-eng';
const MATH = 'subject-math';
const ORG = 'org-1';

const tracksByCode = indexTestTracksByCode([
  { id: 'track-speaking', orgId: null, subjectId: ENG, code: 'SPEAKING' },
  { id: 'track-m1', orgId: null, subjectId: MATH, code: 'M1' },
  { id: 'track-propia', orgId: ORG, subjectId: ENG, code: 'ORAL-CSCJ' },
]);

function target(overrides: Partial<TrackTarget> = {}): TrackTarget {
  return {
    id: 'inst-speaking',
    label: 'DIA Speaking 6°',
    subjectId: ENG,
    orgId: null,
    trackId: null,
    ...overrides,
  };
}

describe('parseTrackArgs', () => {
  it('lee --set repetible, --commit y --dir', () => {
    const args = parseTrackArgs([
      '--set',
      'inst-a=SPEAKING',
      '--dir',
      '/tmp/json',
      '--set',
      'inst-b=M1',
      '--commit',
    ]);
    expect(args.commit).toBe(true);
    expect(args.dirs).toEqual(['/tmp/json']);
    expect(args.explicit).toEqual([
      { instrumentId: 'inst-a', code: 'SPEAKING' },
      { instrumentId: 'inst-b', code: 'M1' },
    ]);
  });

  it('es dry-run por defecto', () => {
    expect(parseTrackArgs(['--set', 'inst-a=SPEAKING']).commit).toBe(false);
  });

  it('rechaza un --set mal formado', () => {
    expect(() => parseTrackArgs(['--set', 'inst-a'])).toThrow('--set espera');
    expect(() => parseTrackArgs(['--set'])).toThrow('--set espera');
  });
});

describe('planTrackAssignments', () => {
  it('asigna una línea oficial de la misma asignatura', () => {
    const plan = planTrackAssignments([{ target: target(), code: 'SPEAKING' }], tracksByCode);
    expect(plan.errors).toEqual([]);
    expect(plan.updates).toEqual([{ instrumentId: 'inst-speaking', trackId: 'track-speaking' }]);
  });

  it('no reescribe una línea ya asignada', () => {
    const plan = planTrackAssignments(
      [{ target: target({ trackId: 'track-speaking' }), code: 'SPEAKING' }],
      tracksByCode,
    );
    expect(plan.updates).toEqual([]);
    expect(plan.alreadySet).toHaveLength(1);
  });

  it('rechaza una línea de otra asignatura', () => {
    const plan = planTrackAssignments([{ target: target(), code: 'M1' }], tracksByCode);
    expect(plan.updates).toEqual([]);
    expect(plan.errors[0]).toContain('otra asignatura');
  });

  it('un instrumento oficial no puede usar una línea privada', () => {
    const plan = planTrackAssignments([{ target: target(), code: 'ORAL-CSCJ' }], tracksByCode);
    expect(plan.errors[0]).toContain('privada');
  });

  it('un instrumento del colegio sí puede usar su línea privada', () => {
    const plan = planTrackAssignments(
      [{ target: target({ orgId: ORG }), code: 'ORAL-CSCJ' }],
      tracksByCode,
    );
    expect(plan.updates).toEqual([{ instrumentId: 'inst-speaking', trackId: 'track-propia' }]);
  });

  it('dos líneas distintas para el mismo instrumento son un error', () => {
    const plan = planTrackAssignments(
      [
        { target: target(), code: 'SPEAKING' },
        { target: target(), code: 'ORAL-CSCJ' },
      ],
      tracksByCode,
    );
    expect(plan.errors[0]).toContain('dos líneas distintas');
  });

  it('la misma línea pedida dos veces se asigna una sola vez', () => {
    const plan = planTrackAssignments(
      [
        { target: target(), code: 'SPEAKING' },
        { target: target(), code: 'SPEAKING' },
      ],
      tracksByCode,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.updates).toHaveLength(1);
  });
});
