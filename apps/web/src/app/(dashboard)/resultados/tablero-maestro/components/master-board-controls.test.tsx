import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { MasterBoardAcademicYear, MasterBoardTake } from '@soe/types';
import { MasterBoardControls } from './master-board-controls';
import { formatTakeWindow, groupTakesByYear } from './take-options';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
}));

afterEach(() => {
  cleanup();
  push.mockReset();
});

const Y2026 = 'aaaaaaaa-0000-4000-8000-000000002026';
const Y2025 = 'aaaaaaaa-0000-4000-8000-000000002025';
const PAES_3 = 'bbbbbbbb-0000-4000-8000-000000000003';
const PAES_5 = 'bbbbbbbb-0000-4000-8000-000000000005';

const ACADEMIC_YEARS: MasterBoardAcademicYear[] = [
  { id: Y2026, year: 2026, label: 'Año 2026', isCurrent: true },
  { id: Y2025, year: 2025, label: 'Año 2025', isCurrent: false },
];

function processTake(id: string, label: string, overrides: Partial<MasterBoardTake> = {}) {
  return {
    key: `process:${id}`,
    label,
    academicYearId: Y2026,
    processId: id,
    processKind: 'paes_ensayo',
    instrumentType: 'paes',
    applicationPeriod: null,
    administeredFrom: '2026-06-10',
    administeredTo: '2026-06-12',
    assessmentCount: 15,
    linkedAssessmentCount: 15,
    hasResults: true,
    partial: false,
    ...overrides,
  } satisfies MasterBoardTake;
}

const LEGACY_2026: MasterBoardTake = {
  key: `legacy:${Y2026}:simce:_`,
  label: 'SIMCE 2026 · sin proceso',
  academicYearId: Y2026,
  processId: null,
  processKind: null,
  instrumentType: 'simce',
  applicationPeriod: null,
  administeredFrom: '2026-05-02',
  administeredTo: '2026-05-02',
  assessmentCount: 3,
  linkedAssessmentCount: 3,
  hasResults: true,
  partial: false,
};

const TAKES: MasterBoardTake[] = [
  processTake(PAES_5, 'Ensayo PAES 5 2026', {
    administeredFrom: null,
    administeredTo: null,
    assessmentCount: 0,
    linkedAssessmentCount: 0,
    hasResults: false,
  }),
  LEGACY_2026,
  processTake(PAES_3, 'Ensayo PAES 3 2026', { partial: true }),
  {
    ...LEGACY_2026,
    key: `legacy:${Y2025}:dia:cierre`,
    label: 'DIA Cierre 2025 · sin proceso',
    academicYearId: Y2025,
    instrumentType: 'dia',
    applicationPeriod: 'cierre',
    administeredFrom: '2025-11-20',
    administeredTo: '2025-11-28',
    assessmentCount: 1,
  },
];

describe('groupTakesByYear', () => {
  it('agrupa por año en el orden de la API y deja las legacy al final de cada año', () => {
    const groups = groupTakesByYear(TAKES, ACADEMIC_YEARS);
    expect(groups.map((group) => group.label)).toEqual(['Año 2026', 'Año 2025']);
    expect(groups[0]!.takes.map((take) => take.label)).toEqual([
      'Ensayo PAES 5 2026',
      'Ensayo PAES 3 2026',
      'SIMCE 2026 · sin proceso',
    ]);
  });
});

describe('formatTakeWindow', () => {
  it('formatea la ventana en es-CL sin correrse de día', () => {
    expect(
      formatTakeWindow({ administeredFrom: '2026-06-10', administeredTo: '2026-06-12' }),
    ).toMatch(/^10 jun\.? – 12 jun\.?$/);
    expect(
      formatTakeWindow({ administeredFrom: '2026-05-02', administeredTo: '2026-05-02' }),
    ).toMatch(/^2 may\.?$/);
    expect(formatTakeWindow({ administeredFrom: null, administeredTo: null })).toBeNull();
  });
});

describe('MasterBoardControls', () => {
  function openTakeSelect() {
    render(
      <MasterBoardControls
        takes={TAKES}
        academicYears={ACADEMIC_YEARS}
        value={{ processId: PAES_3 }}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Toma de evaluaciones' });
    expect(trigger.textContent).toBe('Ensayo PAES 3 2026');
    act(() => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
  }

  it('muestra las tomas agrupadas por año con sus insignias', () => {
    openTakeSelect();
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(2);
    expect(groups[0]!.textContent).toContain('Año 2026');
    expect(groups[1]!.textContent).toContain('Año 2025');

    const options2026 = within(groups[0]!).getAllByRole('option');
    expect(options2026).toHaveLength(3);
    expect(options2026[0]!.textContent).toContain('Sin resultados');
    expect(options2026[0]!.textContent).toContain('0 evaluaciones');
    expect(options2026[1]!.textContent).toContain('Parcial');
    expect(options2026[1]!.textContent).toContain('15 evaluaciones');
    expect(options2026[2]!.textContent).not.toContain('Parcial');
    expect(within(groups[1]!).getByRole('option').textContent).toContain('1 evaluación');
  });

  it('al elegir un proceso navega a ?processId=', () => {
    openTakeSelect();
    const option = screen.getAllByRole('option')[0]!;
    act(() => {
      fireEvent.click(option);
    });
    expect(push).toHaveBeenCalledWith(`/resultados/tablero-maestro?processId=${PAES_5}`);
  });

  it('al elegir una toma legacy navega con año, tipo y período', () => {
    openTakeSelect();
    const legacy = screen.getByRole('option', { name: /DIA Cierre 2025/ });
    act(() => {
      fireEvent.click(legacy);
    });
    expect(push).toHaveBeenCalledWith(
      `/resultados/tablero-maestro?academicYearId=${Y2025}&instrumentType=dia&applicationPeriod=cierre`,
    );
  });
});
