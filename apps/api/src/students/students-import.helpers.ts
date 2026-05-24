import Papa from 'papaparse';

export type RawRosterRow = {
  RUT?: string;
  Nombres?: string;
  Apellidos?: string;
  Curso?: string;
  [key: string]: string | undefined;
};

export const REQUIRED_HEADERS = ['RUT', 'Nombres', 'Apellidos', 'Curso'] as const;

export type CsvParseResult =
  | { ok: true; rows: RawRosterRow[]; missingHeaders: never[] }
  | { ok: false; rows: never[]; missingHeaders: string[] };

/**
 * Parsea un CSV de nómina de alumnos. La primera fila se interpreta como
 * encabezado y se exigen los nombres exactos definidos en `REQUIRED_HEADERS`
 * (la plantilla descargable los provee).
 */
export function parseStudentRosterCsv(buffer: Buffer): CsvParseResult {
  const text = buffer.toString('utf-8').replace(/^﻿/, '');
  const parsed = Papa.parse<RawRosterRow>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return { ok: false, rows: [] as never[], missingHeaders: missing };
  }

  return { ok: true, rows: parsed.data, missingHeaders: [] as never[] };
}

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
