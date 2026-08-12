import type { InstrumentFilterOption } from '../schemas/dashboard.schema';
import { instrumentsInScope, pruneTrajectoryScope } from './trajectory-selection';

function instrument(
  id: string,
  gradeId: string | null,
  subjectId: string | null,
  type: string,
): InstrumentFilterOption {
  return { id, label: id, type, subjectId, gradeId, applicationPeriod: null };
}

const CATALOG: InstrumentFilterOption[] = [
  instrument('mate-5-dia', 'g5', 'mate', 'dia'),
  instrument('mate-5-simce', 'g5', 'mate', 'simce'),
  instrument('leng-5-dia', 'g5', 'leng', 'dia'),
  instrument('mate-6-dia', 'g6', 'mate', 'dia'),
];

describe('pruneTrajectoryScope', () => {
  it('conserva todo lo que sigue siendo válido en el nivel nuevo', () => {
    expect(
      pruneTrajectoryScope(CATALOG, {
        gradeId: 'g6',
        subjectId: 'mate',
        instrumentType: 'dia',
      }),
    ).toEqual({ gradeId: 'g6', subjectId: 'mate', instrumentType: 'dia' });
  });

  it('deja caer la asignatura que no existe en el nivel nuevo y arrastra la medición', () => {
    expect(
      pruneTrajectoryScope(CATALOG, {
        gradeId: 'g6',
        subjectId: 'leng',
        instrumentType: 'dia',
      }),
    ).toEqual({ gradeId: 'g6', subjectId: undefined, instrumentType: undefined });
  });

  it('deja caer sólo la medición cuando la asignatura sobrevive pero ese tipo no existe para ella', () => {
    expect(
      pruneTrajectoryScope(CATALOG, {
        gradeId: 'g6',
        subjectId: 'mate',
        instrumentType: 'simce',
      }),
    ).toEqual({ gradeId: 'g6', subjectId: 'mate', instrumentType: undefined });
  });

  it('deja caer todo cuando el nivel no tiene instrumentos', () => {
    expect(
      pruneTrajectoryScope(CATALOG, {
        gradeId: 'g8',
        subjectId: 'mate',
        instrumentType: 'dia',
      }),
    ).toEqual({ gradeId: undefined, subjectId: undefined, instrumentType: undefined });
  });

  it('valida contra todo el catálogo cuando no hay nivel elegido', () => {
    expect(pruneTrajectoryScope(CATALOG, { subjectId: 'leng', instrumentType: 'dia' })).toEqual({
      gradeId: undefined,
      subjectId: 'leng',
      instrumentType: 'dia',
    });
  });

  it('conserva la asignatura al cambiar de medición dentro del mismo nivel', () => {
    expect(
      pruneTrajectoryScope(CATALOG, {
        gradeId: 'g5',
        subjectId: 'mate',
        instrumentType: 'simce',
      }),
    ).toEqual({ gradeId: 'g5', subjectId: 'mate', instrumentType: 'simce' });
  });

  it('no explota con el scope vacío ni con el catálogo vacío', () => {
    expect(pruneTrajectoryScope(CATALOG, {})).toEqual({
      gradeId: undefined,
      subjectId: undefined,
      instrumentType: undefined,
    });
    expect(pruneTrajectoryScope([], {})).toEqual({
      gradeId: undefined,
      subjectId: undefined,
      instrumentType: undefined,
    });
    expect(
      pruneTrajectoryScope([], { gradeId: 'g5', subjectId: 'mate', instrumentType: 'dia' }),
    ).toEqual({ gradeId: undefined, subjectId: undefined, instrumentType: undefined });
  });
});

describe('instrumentsInScope', () => {
  it('filtra por los campos definidos e ignora los que vienen sin elegir', () => {
    expect(instrumentsInScope(CATALOG, { gradeId: 'g5' }).map((i) => i.id)).toEqual([
      'mate-5-dia',
      'mate-5-simce',
      'leng-5-dia',
    ]);
    expect(instrumentsInScope(CATALOG, { subjectId: 'mate' }).map((i) => i.id)).toEqual([
      'mate-5-dia',
      'mate-5-simce',
      'mate-6-dia',
    ]);
    expect(instrumentsInScope(CATALOG, {}).map((i) => i.id)).toEqual(CATALOG.map((i) => i.id));
  });

  it('no confunde un campo sin elegir con un instrumento sin nivel ni asignatura', () => {
    const catalog = [...CATALOG, instrument('suelto', null, null, 'dia')];
    expect(instrumentsInScope(catalog, { gradeId: 'g5' }).map((i) => i.id)).not.toContain('suelto');
    expect(instrumentsInScope(catalog, { instrumentType: 'dia' }).map((i) => i.id)).toContain(
      'suelto',
    );
  });
});
