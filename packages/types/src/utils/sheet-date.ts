/**
 * Fecha de aplicación de una evaluación en papel: el profesor la elige como día
 * de calendario (`AAAA-MM-DD`), no como instante. Para que ese día sobreviva al
 * viaje por un `timestamp` de Postgres y vuelva idéntico en cualquier zona
 * horaria, se ancla al mediodía UTC y se lee siempre por sus componentes UTC.
 */

export const SHEET_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const NOON_UTC_SUFFIX = 'T12:00:00.000Z';

export function isSheetDate(value: string): boolean {
  return SHEET_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}${NOON_UTC_SUFFIX}`));
}

export function parseSheetDate(value: string): Date {
  return new Date(`${value}${NOON_UTC_SUFFIX}`);
}

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `AAAA-MM-DD` para un `<input type="date">`. */
export function toSheetDateInput(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  const date = toDate(value);
  return date === null ? '' : date.toISOString().slice(0, 10);
}

/** El día de hoy en la zona horaria del navegador o del servidor, como `AAAA-MM-DD`. */
export function todaySheetDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** `DD/MM/AAAA`, el formato que se imprime en la hoja. */
export function formatSheetDayMonthYear(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = toDate(value);
  if (date === null) return null;
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}
