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
 *
 * Decodifica como UTF-8 (con BOM opcional). Si Excel exportó el archivo en
 * Windows-1252 (caso típico al "Guardar como CSV"), reintenta con latin1
 * para no romper acentos y ñ.
 */
export function parseStudentRosterCsv(buffer: Buffer): CsvParseResult {
  const text = decodeCsvBuffer(buffer);
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

function decodeCsvBuffer(buffer: Buffer): string {
  // BOM UTF-8 explícito → es UTF-8 sí o sí.
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf-8');
  }
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buffer);
  } catch {
    // Bytes inválidos en UTF-8 → asumir Windows-1252 (lo que produce Excel al
    // "Guardar como CSV" sin elegir "CSV UTF-8").
    return buffer.toString('latin1');
  }
}

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
