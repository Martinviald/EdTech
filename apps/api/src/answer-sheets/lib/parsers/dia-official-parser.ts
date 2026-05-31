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
 * Parser para el CSV oficial de la Agencia de Calidad (formato DIA — H16.4).
 *
 * Asumimos la versión documentada por la Agencia:
 *   RUT, Apellidos, Nombres, p1, p2, p3, ...
 *
 * (Si la versión real entregada por la Agencia difiere, se ajusta acá sin
 * impactar al service ni al matcher).
 *
 * Convenciones:
 *  - Las columnas de preguntas usan prefijo `p` minúscula: `p1`, `p2`, ...
 *  - Apellidos y Nombres llegan separados; se concatenan en `studentFullName`.
 */
export function parseDiaOfficialCsv(buffer: Buffer): ParserResult {
  const text = decodeCsvBuffer(buffer);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const detectedColumns = parsed.meta.fields ?? [];
  const warnings: string[] = [];

  const questionColumns = detectedColumns.filter((c) => /^p\d+$/i.test(c));
  if (questionColumns.length === 0) {
    warnings.push(
      'No se detectaron columnas de preguntas con formato "p1", "p2", etc. en el CSV.',
    );
  }

  const rows: ParsedAnswerSheetRow[] = [];
  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const errors: AnswerSheetRowError[] = [];

    const studentRut = (raw['RUT'] ?? '').trim() || null;
    const apellidos = (raw['Apellidos'] ?? '').trim();
    const nombres = (raw['Nombres'] ?? '').trim();
    const studentFullName =
      apellidos || nombres ? `${nombres} ${apellidos}`.trim() : null;

    if (!studentRut) {
      errors.push({ rowNumber, field: 'RUT', message: 'Falta el RUT del alumno' });
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
