import { parseCsvHeaders } from './csv-parser';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function isXlsxFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.xlsx') || file.type === XLSX_MIME;
}

async function parseXlsxHeaders(file: File): Promise<string[]> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
  const headerRow = rows.find(
    (row) => Array.isArray(row) && row.filter((cell) => String(cell ?? '').trim() !== '').length >= 2,
  );
  if (!headerRow) return [];
  return (headerRow as unknown[]).map((cell) => String(cell ?? '').trim()).filter((cell) => cell.length > 0);
}

/**
 * Lee la fila de encabezado de un archivo CSV o Excel para armar la UI de mapeo
 * de columnas del formato genérico. El módulo `xlsx` se carga bajo demanda para
 * no sumarlo al bundle inicial.
 */
export function parseSpreadsheetHeaders(file: File): Promise<string[]> {
  return isXlsxFile(file) ? parseXlsxHeaders(file) : parseCsvHeaders(file);
}
