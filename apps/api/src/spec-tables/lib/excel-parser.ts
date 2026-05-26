import * as XLSX from 'xlsx';

export interface ParsedSheet {
  columns: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

/**
 * Parses an Excel (.xlsx) or CSV buffer and returns structured data.
 *
 * For CSV files the buffer is decoded as UTF-8 so that accented characters
 * (common in Spanish) are preserved correctly.  XLSX files are binary and
 * handled natively by SheetJS.
 *
 * @param buffer  Raw file contents
 * @param sheetIndex  Which sheet to read (0-based, default first)
 */
export function parseExcelBuffer(
  buffer: Buffer,
  sheetIndex = 0,
): ParsedSheet {
  if (!buffer || buffer.length === 0) {
    return { columns: [], rows: [], totalRows: 0 };
  }

  // Detect whether the buffer looks like a plain-text CSV (as opposed to a
  // binary XLSX).  XLSX files start with the PK zip signature (0x50 0x4B).
  const isLikelyCsv = buffer.length < 2 || (buffer[0] !== 0x50 || buffer[1] !== 0x4b);

  const workbook = isLikelyCsv
    ? XLSX.read(buffer.toString('utf-8'), { type: 'string' })
    : XLSX.read(buffer, { type: 'buffer' });

  if (workbook.SheetNames.length === 0) {
    return { columns: [], rows: [], totalRows: 0 };
  }

  const effectiveIndex = Math.min(sheetIndex, workbook.SheetNames.length - 1);
  const sheetName = workbook.SheetNames[effectiveIndex];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return { columns: [], rows: [], totalRows: 0 };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: '',
    raw: false,
  });

  const columns = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];

  return {
    columns,
    rows: jsonData,
    totalRows: jsonData.length,
  };
}
