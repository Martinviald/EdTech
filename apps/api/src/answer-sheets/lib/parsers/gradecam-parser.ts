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
 * Parser para CSV exportado por Gradecam.
 *
 * Convención de columnas:
 *   Student ID, First Name, Last Name, Q1, Q2, Q3, ...
 *
 * - `Student ID`: RUT del alumno (el colegio configura Gradecam para usar RUT).
 * - `Q{n}`: alternativa marcada (A/B/C/D/E) o vacío si en blanco.
 */
export function parseGradecamCsv(buffer: Buffer): ParserResult {
  const text = decodeCsvBuffer(buffer);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const detectedColumns = parsed.meta.fields ?? [];
  const warnings: string[] = [];

  const questionColumns = detectedColumns.filter((c) => /^Q\d+$/i.test(c));
  if (questionColumns.length === 0) {
    warnings.push(
      'No se detectaron columnas de preguntas con formato "Q1", "Q2", etc. en el CSV.',
    );
  }

  const rows: ParsedAnswerSheetRow[] = [];
  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 2; // +1 por header, +1 por base 1
    const errors: AnswerSheetRowError[] = [];

    const studentRut = (raw['Student ID'] ?? '').trim() || null;
    const firstName = (raw['First Name'] ?? '').trim();
    const lastName = (raw['Last Name'] ?? '').trim();
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

    // Saltar filas completamente vacías (sin RUT y sin respuestas).
    if (!studentRut && Object.values(answers).every((v) => v === null) && !studentFullName) {
      return;
    }

    rows.push({ rowNumber, studentRut, studentFullName, answers, errors });
  });

  return { rows, detectedColumns, warnings };
}
