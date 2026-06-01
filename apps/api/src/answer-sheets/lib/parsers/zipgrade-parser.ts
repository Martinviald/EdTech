import Papa from 'papaparse';
import type { AnswerSheetRowError } from '@soe/types';
import {
  decodeCsvBuffer,
  normalizeAnswerValue,
  questionColumnToPosition,
  type ParsedAnswerSheetRow,
  type ParserResult,
} from './parser.types';

/**
 * Parser para CSV exportado por ZipGrade.
 *
 * Convención de columnas:
 *   Student First Name, Student Last Name, Student ID, Q01, Q02, ...
 *
 * Diferencias con Gradecam:
 *  - Las columnas de preguntas usan padding (`Q01`, `Q02`).
 *  - El orden de nombre/apellido/ID es distinto, pero parseamos por nombre
 *    de columna (no por posición) para ser robustos.
 */
export function parseZipgradeCsv(buffer: Buffer): ParserResult {
  const text = decodeCsvBuffer(buffer);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const detectedColumns = parsed.meta.fields ?? [];
  const warnings: string[] = [];

  const questionColumns = detectedColumns.filter((c) => /^Q0*\d+$/i.test(c));
  if (questionColumns.length === 0) {
    warnings.push(
      'No se detectaron columnas de preguntas con formato "Q01", "Q02", etc. en el CSV.',
    );
  }

  const rows: ParsedAnswerSheetRow[] = [];
  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors: AnswerSheetRowError[] = [];

    const studentRut = (raw['Student ID'] ?? '').trim() || null;
    const firstName = (raw['Student First Name'] ?? '').trim();
    const lastName = (raw['Student Last Name'] ?? '').trim();
    const studentFullName =
      firstName || lastName ? `${firstName} ${lastName}`.trim() : null;

    if (!studentRut) {
      errors.push({ rowNumber, field: 'Student ID', message: 'Falta el RUT del alumno' });
    }

    const answers: Record<string, string | null> = {};
    for (const col of questionColumns) {
      const position = questionColumnToPosition(col);
      if (!position) continue;
      answers[position] = normalizeAnswerValue(raw[col]);
    }

    if (!studentRut && Object.values(answers).every((v) => v === null) && !studentFullName) {
      return;
    }

    rows.push({ rowNumber, studentRut, studentFullName, answers, errors });
  });

  return { rows, detectedColumns, warnings };
}
