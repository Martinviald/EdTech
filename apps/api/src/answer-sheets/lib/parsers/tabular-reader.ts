import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { decodeCsvBuffer } from './parser.types';

function looksLikeXlsx(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function toCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function isEmptyRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}

function readCsvMatrix(buffer: Buffer): string[][] {
  const text = decodeCsvBuffer(buffer);
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
  return parsed.data.map((row) => (Array.isArray(row) ? row.map(toCell) : []));
}

function readXlsxMatrix(buffer: Buffer, sheetIndex: number): string[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  if (workbook.SheetNames.length === 0) return [];
  const name = workbook.SheetNames[Math.min(sheetIndex, workbook.SheetNames.length - 1)];
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
  return rows.map((row) => (Array.isArray(row) ? row.map(toCell) : []));
}

export function readTabularMatrix(buffer: Buffer, sheetIndex = 0): string[][] {
  if (!buffer || buffer.length === 0) return [];
  const matrix = looksLikeXlsx(buffer)
    ? readXlsxMatrix(buffer, sheetIndex)
    : readCsvMatrix(buffer);
  return matrix.filter((row) => !isEmptyRow(row));
}
