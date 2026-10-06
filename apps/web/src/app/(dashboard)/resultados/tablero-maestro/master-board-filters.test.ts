import type { MasterBoardTake } from '@soe/types';
import {
  buildMasterBoardQuery,
  defaultTake,
  hasSelectedTake,
  parseMasterBoardFilters,
  takeKeyOf,
  takeToFilterValues,
} from './master-board-filters';

const PROCESS_ID = '9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d';
const YEAR_ID = '1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d';

function take(overrides: Partial<MasterBoardTake>): MasterBoardTake {
  return {
    key: `process:${PROCESS_ID}`,
    label: 'Ensayo PAES 3 2026',
    academicYearId: YEAR_ID,
    processId: PROCESS_ID,
    processKind: null,
    instrumentType: 'paes',
    applicationPeriod: null,
    administeredFrom: '2026-06-10',
    administeredTo: '2026-06-12',
    assessmentCount: 15,
    linkedAssessmentCount: 15,
    hasResults: true,
    partial: false,
    ...overrides,
  };
}

describe('parseMasterBoardFilters', () => {
  it('lee processId y la métrica', () => {
    const filters = parseMasterBoardFilters({ processId: PROCESS_ID, metric: 'achievement' });
    expect(filters.processId).toBe(PROCESS_ID);
    expect(filters.metric).toBe('achievement');
    expect(hasSelectedTake(filters)).toBe(true);
    expect(takeKeyOf(filters)).toBe(`process:${PROCESS_ID}`);
  });

  it('descarta un processId que no es uuid', () => {
    const filters = parseMasterBoardFilters({ processId: 'no-es-uuid' });
    expect(filters.processId).toBeUndefined();
    expect(hasSelectedTake(filters)).toBe(false);
  });

  it('sigue aceptando la URL legacy', () => {
    const filters = parseMasterBoardFilters({
      academicYearId: YEAR_ID,
      instrumentType: 'dia',
      applicationPeriod: 'intermedio',
    });
    expect(filters.processId).toBeUndefined();
    expect(hasSelectedTake(filters)).toBe(true);
    expect(takeKeyOf(filters)).toBe(`legacy:${YEAR_ID}:dia:intermedio`);
  });

  it('usa "_" como período de una toma legacy sin período', () => {
    const filters = parseMasterBoardFilters({ academicYearId: YEAR_ID, instrumentType: 'dia' });
    expect(takeKeyOf(filters)).toBe(`legacy:${YEAR_ID}:dia:_`);
  });
});

describe('buildMasterBoardQuery', () => {
  it('con processId omite los parámetros de toma legacy', () => {
    const query = buildMasterBoardQuery({
      processId: PROCESS_ID,
      academicYearId: YEAR_ID,
      instrumentType: 'dia',
      applicationPeriod: 'intermedio',
      assessmentId: ['x'],
      metric: 'achievement',
    });
    expect(query).toBe(`?processId=${PROCESS_ID}&metric=achievement`);
  });

  it('arma la query legacy como antes', () => {
    const query = buildMasterBoardQuery({
      academicYearId: YEAR_ID,
      instrumentType: 'dia',
      applicationPeriod: 'intermedio',
    });
    expect(query).toBe(
      `?academicYearId=${YEAR_ID}&instrumentType=dia&applicationPeriod=intermedio`,
    );
  });

  it('ida y vuelta con parseMasterBoardFilters', () => {
    const query = buildMasterBoardQuery({ processId: PROCESS_ID, metric: 'achievement' });
    const params = Object.fromEntries(new URLSearchParams(query));
    expect(parseMasterBoardFilters(params)).toMatchObject({
      processId: PROCESS_ID,
      metric: 'achievement',
    });
  });
});

describe('takeToFilterValues', () => {
  it('una toma de proceso navega por processId', () => {
    expect(takeToFilterValues(take({}), 'achievement')).toEqual({
      processId: PROCESS_ID,
      metric: 'achievement',
    });
  });

  it('una toma legacy navega por año, tipo y período', () => {
    const legacy = take({
      key: `legacy:${YEAR_ID}:dia:intermedio`,
      processId: null,
      instrumentType: 'dia',
      applicationPeriod: 'intermedio',
    });
    expect(takeToFilterValues(legacy, undefined)).toEqual({
      academicYearId: YEAR_ID,
      instrumentType: 'dia',
      applicationPeriod: 'intermedio',
      metric: undefined,
    });
    expect(takeKeyOf(takeToFilterValues(legacy, undefined))).toBe(legacy.key);
  });
});

describe('defaultTake', () => {
  it('elige la primera toma con resultados aunque haya una más reciente sin ellos', () => {
    const sinResultados = take({ key: 'process:nuevo', hasResults: false });
    const conResultados = take({ key: 'process:anterior', hasResults: true });
    expect(defaultTake([sinResultados, conResultados])).toBe(conResultados);
  });

  it('si ninguna tiene resultados, cae en la primera', () => {
    const primera = take({ key: 'process:a', hasResults: false });
    const segunda = take({ key: 'process:b', hasResults: false });
    expect(defaultTake([primera, segunda])).toBe(primera);
  });

  it('sin tomas no hay toma por defecto', () => {
    expect(defaultTake([])).toBeUndefined();
  });
});
