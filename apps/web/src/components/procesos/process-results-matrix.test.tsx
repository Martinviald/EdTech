import { cleanup, render, screen } from '@testing-library/react';
import { deriveProcessRollup, type ComparableUnitSummary } from '@soe/types';
import type { PerformanceBandView } from '@soe/types';
import { ProcessResultsMatrix } from './process-results-matrix';

afterEach(cleanup);

const DIA: PerformanceBandView[] = [
  { key: 'n1', label: 'Nivel 1', order: 0, color: '#a00' },
  { key: 'n2', label: 'Nivel 2', order: 1, color: '#aa0' },
  { key: 'n3', label: 'Nivel 3', order: 2, color: '#0a0' },
];

const CEFR: PerformanceBandView[] = [
  { key: 'a1', label: 'A1', order: 0, color: null },
  { key: 'a2', label: 'A2', order: 1, color: null },
];

function unit(
  key: string,
  bands: PerformanceBandView[],
  counts: number[],
  over: Partial<ComparableUnitSummary> = {},
): ComparableUnitSummary {
  const total = counts.reduce((a, b) => a + b, 0);
  return {
    key: key,
    instrumentId: key,
    instrumentName: key,
    instrumentType: 'dia',
    subjectId: 's1',
    subjectName: 'Lenguaje',
    gradeId: 'g1',
    gradeName: '1B',
    applicationPeriod: null,
    year: null,
    trackId: null,
    assessmentIds: [],
    lastAdministeredAt: null,
    studentsAssessed: total,
    averageAchievement: null,
    bands,
    bandDistribution: bands.map((b, i) => ({
      key: b.key,
      label: b.label,
      order: b.order,
      color: b.color ?? null,
      count: counts[i] as number,
      percentage: total > 0 ? ((counts[i] as number) / total) * 100 : 0,
    })),
    levelDistribution: null,
    lowestBandShare: total > 0 ? ((counts[0] as number) / total) * 100 : null,
    byClassGroup: [],
    byAssessment: [],
    baseline: null,
    severity: 'high',
    ...over,
  } as ComparableUnitSummary;
}

describe('ProcessResultsMatrix', () => {
  it('la celda muestra una fracción de alumnos y ningún porcentaje', () => {
    // Un número con % en una grilla curso × asignatura se lee como % de logro,
    // donde más es mejor, y acá la lectura es la inversa.
    const r = deriveProcessRollup(
      [
        unit('a', DIA, [1, 9, 0]),
        unit('b', DIA, [6, 4, 0]),
        unit('c', DIA, [2, 8, 0], { gradeId: 'g2', gradeName: '2B', subjectId: 's2' }),
      ],
      null,
    );
    const { container } = render(
      <ProcessResultsMatrix rollup={r} coverage={null} processId="p1" />,
    );

    expect(screen.getByText('7 de 20')).toBeTruthy();
    // Acotado a la tabla: la descripción de la tarjeta sí dice "No es % de logro",
    // que es justamente la advertencia.
    expect(container.querySelector('table')?.textContent).not.toContain('%');
  });

  it('con una sola asignatura no se dibuja', () => {
    const r = deriveProcessRollup(
      [unit('a', DIA, [1, 9, 0]), unit('b', DIA, [2, 8, 0], { gradeId: 'g2', gradeName: '2B' })],
      null,
    );
    render(<ProcessResultsMatrix rollup={r} coverage={null} processId="p1" />);

    expect(screen.queryByText('Curso')).toBeNull();
  });

  it('con dos escaleras en la celda dice cuántos instrumentos, sin número', () => {
    const r = deriveProcessRollup(
      [
        unit('dia', DIA, [1, 9, 0]),
        unit('ingles', CEFR, [10, 0]),
        unit('c', DIA, [2, 8, 0], { gradeId: 'g2', gradeName: '2B', subjectId: 's2' }),
      ],
      null,
    );
    render(<ProcessResultsMatrix rollup={r} coverage={null} processId="p1" />);

    expect(screen.getByText('2 instrumentos')).toBeTruthy();
  });

  it('ordena las filas por grado y no por severidad', () => {
    const r = deriveProcessRollup(
      [
        unit('u8', DIA, [9, 1, 0], { gradeId: 'g8', gradeName: '8B' }),
        unit('u1', DIA, [1, 9, 0], { gradeId: 'g1', gradeName: '1B' }),
        unit('u8b', DIA, [5, 5, 0], { gradeId: 'g8', gradeName: '8B', subjectId: 's2' }),
      ],
      null,
      new Map([
        ['g1', 0],
        ['g8', 7],
      ]),
    );
    render(<ProcessResultsMatrix rollup={r} coverage={null} processId="p1" />);

    const filas = screen.getAllByRole('rowheader').map((th) => th.textContent);
    expect(filas).toEqual(['1B', '8B']);
  });
});
