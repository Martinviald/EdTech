import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComparableTrajectoryPoint, ComparableTrajectoryYearSeries } from '@soe/types';
import { TrajectoryComparePicker } from './trajectory-compare-picker';

afterEach(cleanup);

function point(key: string, label: string, assessmentIds: string[]): ComparableTrajectoryPoint {
  return {
    key,
    label,
    year: 2026,
    applicationPeriod: null,
    instrumentId: `instr-${key}`,
    instrumentName: 'Lectura',
    assessmentIds,
    administeredAt: null,
    studentsAssessed: 30,
    averageAchievement: 60,
    bandDistribution: null,
  };
}

function seriesWith(points: ComparableTrajectoryPoint[]): ComparableTrajectoryYearSeries[] {
  return [{ year: 2026, label: '2026', currentGradeName: null, points }];
}

function compareLink(): HTMLElement | null {
  return screen.queryByRole('link', { name: /Comparar/ });
}

describe('TrajectoryComparePicker', () => {
  it('abre el comparador con ambas evaluaciones cuando cada punto es una sola', () => {
    render(
      <TrajectoryComparePicker
        series={seriesWith([
          point('diagnostico', 'Diagnóstico', ['a1']),
          point('cierre', 'Cierre', ['a2']),
        ])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Diagnóstico 2026/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cierre 2026/ }));

    expect(compareLink()?.getAttribute('href')).toBe(
      '/comparar-instrumentos?baseId=a1&comparisonId=a2',
    );
  });

  it('abre sólo con la base cuando el otro punto agrupa varias evaluaciones', () => {
    render(
      <TrajectoryComparePicker
        series={seriesWith([
          point('diagnostico', 'Diagnóstico', ['a1']),
          point('cierre', 'Cierre', ['b1', 'b2']),
        ])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Cierre 2026/ }));
    fireEvent.click(screen.getByRole('button', { name: /Diagnóstico 2026/ }));

    expect(compareLink()?.getAttribute('href')).toBe('/comparar-instrumentos?baseId=a1');
  });

  it('no ofrece comparar si ambos puntos agrupan varias evaluaciones', () => {
    render(
      <TrajectoryComparePicker
        series={seriesWith([
          point('diagnostico', 'Diagnóstico', ['a1', 'a2']),
          point('cierre', 'Cierre', ['b1', 'b2']),
        ])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Diagnóstico 2026/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cierre 2026/ }));

    expect(compareLink()).toBeNull();
    expect(screen.getByText(/Elige un curso para compararlas/)).toBeTruthy();
  });
});
