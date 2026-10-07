import { cleanup, render, screen } from '@testing-library/react';
import { deriveProcessRollup, type ComparableUnitSummary } from '@soe/types';
import type { PerformanceBandView } from '@soe/types';
import { ProcessLevelHeadline } from './process-level-headline';

afterEach(cleanup);

const DIA: PerformanceBandView[] = [
  { key: 'n1', label: 'Nivel 1', order: 0, color: '#a00' },
  { key: 'n2', label: 'Nivel 2', order: 1, color: '#aa0' },
];

function unit(counts: [number, number]): ComparableUnitSummary {
  const total = counts[0] + counts[1];
  return {
    key: 'u1',
    instrumentId: 'u1',
    instrumentName: 'u1',
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
    bands: DIA,
    bandDistribution: DIA.map((b, i) => ({
      key: b.key,
      label: b.label,
      order: b.order,
      color: b.color ?? null,
      count: counts[i] as number,
      percentage: ((counts[i] as number) / total) * 100,
    })),
    levelDistribution: null,
    lowestBandShare: (counts[0] / total) * 100,
    byClassGroup: [],
    byAssessment: [],
    baseline: null,
    severity: 'high',
  };
}

const ROLLUP = deriveProcessRollup([unit([4, 6])], null);

describe('ProcessLevelHeadline', () => {
  it('completo muestra el desglose por banda y la procedencia del corte', () => {
    render(<ProcessLevelHeadline rollup={ROLLUP} coverageSummary={null} />);

    expect(screen.getByText('Nivel 1: 4')).toBeTruthy();
    expect(
      screen.getByText(/Cada alumno está clasificado con el corte de su propia prueba/),
    ).toBeTruthy();
  });

  it('compacto deja fuera el desglose y la nota del corte', () => {
    render(<ProcessLevelHeadline rollup={ROLLUP} coverageSummary={null} compact />);

    expect(screen.queryByText('Nivel 1: 4')).toBeNull();
    expect(
      screen.queryByText(/Cada alumno está clasificado con el corte de su propia prueba/),
    ).toBeNull();
  });

  it('sin denominador dice "en tus cursos" en vez de celdas', () => {
    // Alcance docente: el denominador de /coverage es el del colegio entero.
    render(<ProcessLevelHeadline rollup={ROLLUP} coverageSummary={null} />);

    expect(screen.getByText(/en tus cursos/)).toBeTruthy();
  });

  it('compacto NO oculta el aviso de medición en curso', () => {
    // D4: el gate de cobertura no es un detalle de análisis, es la condición
    // para creerle al número.
    const parcial = deriveProcessRollup([unit([4, 6])], {
      processId: 'p1',
      scopeDefined: true,
      scopeDerived: false,
      totals: { expected: 10, missing: 8, scheduled: 0, partial: 0, complete: 2 },
      cells: Array.from({ length: 10 }, (_, i) => ({
        classGroupId: `cg${i}`,
        classGroupName: 'A',
        gradeId: 'g1',
        gradeShortName: '1B',
        gradeOrder: 1,
        subjectId: 's1',
        subjectName: 'Lenguaje',
        subjectShortName: 'LANG',
        status: 'complete' as const,
        assessmentId: null,
        assessmentName: null,
        studentsExpected: 26,
        studentsWithResults: 26,
      })),
      unexpectedCells: [],
    });

    render(
      <ProcessLevelHeadline
        rollup={parcial}
        coverageSummary={{ loadedCells: 2, expectedCells: 10 }}
        compact
      />,
    );

    expect(screen.getByText(/Medición en curso/)).toBeTruthy();
  });
});
