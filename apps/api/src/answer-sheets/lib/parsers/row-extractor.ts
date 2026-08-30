import type { AnswerSheetRowError } from '@soe/types';
import {
  normalizeAnswerValue,
  normalizeHeaderText,
  type ParsedAnswerSheetRow,
  type ParserResult,
} from './parser.types';
import type { FormatProfile } from './format-profiles';
import type { ResolvedColumns } from './column-resolver';

function cell(row: readonly string[], index: number): string {
  if (index < 0 || index >= row.length) return '';
  return (row[index] ?? '').trim();
}

function isFooterLabel(text: string, profile: FormatProfile): boolean {
  const norm = normalizeHeaderText(text);
  if (norm.length === 0) return false;
  if (profile.footerLabels.includes(norm)) return true;
  return norm.startsWith('answers') || norm.includes('max points');
}

function isFooterRow(row: readonly string[], cols: ResolvedColumns, profile: FormatProfile): boolean {
  const candidates = [
    cell(row, cols.fullNameIndex),
    cell(row, cols.firstNameIndex),
    cell(row, cols.lastNameIndex),
    cell(row, cols.rutIndex),
    cell(row, 0),
  ];
  return candidates.some((c) => isFooterLabel(c, profile));
}

function resolveFullName(row: readonly string[], cols: ResolvedColumns, profile: FormatProfile): string | null {
  if (profile.nameMode === 'single-lastfirst') {
    const raw = cell(row, cols.fullNameIndex);
    if (!raw) return null;
    const comma = raw.indexOf(',');
    if (comma === -1) return raw;
    const last = raw.slice(0, comma).trim();
    const first = raw.slice(comma + 1).trim();
    return `${first} ${last}`.trim() || null;
  }
  if (profile.nameMode === 'first-last-split') {
    const first = cell(row, cols.firstNameIndex);
    const last = cell(row, cols.lastNameIndex);
    return first || last ? `${first} ${last}`.trim() : null;
  }
  return null;
}

export function extractRows(
  matrix: readonly string[][],
  headerIndex: number,
  cols: ResolvedColumns,
  profile: FormatProfile,
): ParserResult {
  const header = headerIndex >= 0 ? matrix[headerIndex] : [];
  const detectedColumns = header.map((c) => c.trim()).filter((c) => c.length > 0);
  const warnings: string[] = [];

  if (cols.questionColumns.length === 0) {
    warnings.push('No se detectaron columnas de preguntas en el archivo.');
  }

  const rows: ParsedAnswerSheetRow[] = [];
  const dataRows = headerIndex >= 0 ? matrix.slice(headerIndex + 1) : [];

  dataRows.forEach((raw, idx) => {
    if (isFooterRow(raw, cols, profile)) return;

    const rowNumber = idx + 2;
    const errors: AnswerSheetRowError[] = [];

    const studentRut = cell(raw, cols.rutIndex) || null;
    const studentFullName = resolveFullName(raw, cols, profile);

    if (!studentRut) {
      errors.push({ rowNumber, field: 'studentRut', message: 'Falta el RUT del alumno' });
    }

    const answers: Record<string, string | null> = {};
    for (const q of cols.questionColumns) {
      answers[q.label] = normalizeAnswerValue(cell(raw, q.index));
    }

    if (!studentRut && !studentFullName && Object.values(answers).every((v) => v === null)) {
      return;
    }

    rows.push({ rowNumber, studentRut, studentFullName, answers, errors });
  });

  return { rows, detectedColumns, warnings };
}
