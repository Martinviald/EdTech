import Papa from 'papaparse';
import type { AnswerSheetColumnMapping, AnswerSheetRowError } from '@soe/types';
import {
  decodeCsvBuffer,
  normalizeAnswerValue,
  questionColumnToPosition,
  type ParsedAnswerSheetRow,
  type ParserResult,
} from './parser.types';

/**
 * Parser CSV genérico configurable.
 *
 * El usuario indica vía `columnMapping`:
 *  - `rut`, `firstName`, `lastName`: nombres de las columnas con esos datos.
 *  - `questionsPrefix`: si las columnas de preguntas usan un prefijo (`Q`, `p`,
 *    `Item`...), todas las columnas que matcheen `^{prefix}\d+$` se toman.
 *  - `questionColumns`: alternativa al prefix, lista explícita de columnas.
 *
 * El nombre canónico de la pregunta (la "position") siempre se deriva de los
 * dígitos en la columna, no del orden — para que el CSV pueda omitir columnas.
 */
export function parseGenericCsv(
  buffer: Buffer,
  mapping: AnswerSheetColumnMapping,
): ParserResult {
  const text = decodeCsvBuffer(buffer);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const detectedColumns = parsed.meta.fields ?? [];
  const warnings: string[] = [];

  const rutCol = mapping.rut ?? null;
  const firstNameCol = mapping.firstName ?? null;
  const lastNameCol = mapping.lastName ?? null;

  if (!rutCol) {
    warnings.push(
      'columnMapping.rut no especificado: las filas no se podrán matchear con alumnos.',
    );
  }

  // Resolver columnas de preguntas.
  let questionColumns: string[] = [];
  if (mapping.questionColumns && mapping.questionColumns.length > 0) {
    questionColumns = mapping.questionColumns.filter((c: string) =>
      detectedColumns.includes(c),
    );
  } else if (mapping.questionsPrefix) {
    const pattern = new RegExp(
      `^${escapeRegex(mapping.questionsPrefix)}0*\\d+$`,
      'i',
    );
    questionColumns = detectedColumns.filter((c) => pattern.test(c));
  } else {
    warnings.push(
      'columnMapping no indica questionsPrefix ni questionColumns: no se detectaron preguntas.',
    );
  }

  if (questionColumns.length === 0 && (mapping.questionsPrefix || mapping.questionColumns)) {
    warnings.push('No se encontraron columnas de preguntas en el CSV con la configuración dada.');
  }

  const rows: ParsedAnswerSheetRow[] = [];
  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors: AnswerSheetRowError[] = [];

    const studentRut = rutCol ? (raw[rutCol] ?? '').trim() || null : null;
    const firstName = firstNameCol ? (raw[firstNameCol] ?? '').trim() : '';
    const lastName = lastNameCol ? (raw[lastNameCol] ?? '').trim() : '';
    const studentFullName =
      firstName || lastName ? `${firstName} ${lastName}`.trim() : null;

    if (!studentRut && rutCol) {
      errors.push({ rowNumber, field: rutCol, message: 'Falta el RUT del alumno' });
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
