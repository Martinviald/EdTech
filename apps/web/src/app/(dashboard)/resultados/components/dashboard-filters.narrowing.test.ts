import { hasNarrowingFilters } from './dashboard-filters';

describe('hasNarrowingFilters', () => {
  it('el proceso solo no recorta nada', () => {
    expect(hasNarrowingFilters({ processId: 'p1' })).toBe(false);
  });

  it('el año académico no recorta: se preselecciona y el proceso vive en un año', () => {
    expect(hasNarrowingFilters({ processId: 'p1', academicYearId: 'y1' })).toBe(false);
  });

  it.each([
    ['subjectId', { subjectId: ['s1'] }],
    ['gradeId', { gradeId: ['g1'] }],
    ['classGroupId', { classGroupId: ['c1'] }],
    ['instrumentType', { instrumentType: ['dia'] }],
    ['applicationPeriod', { applicationPeriod: ['intermediate'] }],
    ['instrumentId', { instrumentId: 'i1' }],
    ['studentId', { studentId: 'st1' }],
    ['q', { q: 'ensayo' }],
  ])('%s recorta el proceso', (_clave, filtro) => {
    expect(hasNarrowingFilters({ processId: 'p1', ...filtro })).toBe(true);
  });

  it('un array vacío no recorta', () => {
    expect(hasNarrowingFilters({ processId: 'p1', subjectId: [] })).toBe(false);
  });

  it('un texto vacío no recorta', () => {
    expect(hasNarrowingFilters({ processId: 'p1', q: '' })).toBe(false);
  });
});
