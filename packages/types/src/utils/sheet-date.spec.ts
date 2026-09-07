import {
  formatSheetDayMonthYear,
  isSheetDate,
  parseSheetDate,
  toSheetDateInput,
  todaySheetDate,
} from './sheet-date';

describe('parseSheetDate', () => {
  it('ancla el día al mediodía UTC para que ninguna zona horaria lo corra', () => {
    expect(parseSheetDate('2026-04-30').toISOString()).toBe('2026-04-30T12:00:00.000Z');
  });

  it('sobrevive el viaje de ida y vuelta', () => {
    expect(toSheetDateInput(parseSheetDate('2026-01-01'))).toBe('2026-01-01');
    expect(formatSheetDayMonthYear(parseSheetDate('2026-01-01'))).toBe('01/01/2026');
  });
});

describe('isSheetDate', () => {
  it.each(['2026-04-30', '2026-12-31'])('acepta %s', (value) => {
    expect(isSheetDate(value)).toBe(true);
  });

  it.each(['30-04-2026', '2026/04/30', '2026-13-01', ''])('rechaza %s', (value) => {
    expect(isSheetDate(value)).toBe(false);
  });
});

describe('formatSheetDayMonthYear', () => {
  it('devuelve null cuando no hay fecha', () => {
    expect(formatSheetDayMonthYear(null)).toBeNull();
    expect(formatSheetDayMonthYear(undefined)).toBeNull();
  });

  it('imprime DD/MM/AAAA', () => {
    expect(formatSheetDayMonthYear('2026-04-30')).toBe('30/04/2026');
  });
});

describe('todaySheetDate', () => {
  it('usa el día local, no el UTC', () => {
    expect(todaySheetDate(new Date(2026, 3, 30, 23, 30))).toBe('2026-04-30');
  });
});
