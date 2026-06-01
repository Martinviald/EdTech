import Papa from 'papaparse';
import { inviteMemberSchema, type InviteMemberDto } from '@soe/types';

export interface ParsedMembersCsv {
  valid: InviteMemberDto[];
  errors: Array<{ row: number; raw: Record<string, string>; message: string }>;
  totalRows: number;
}

/**
 * Lee únicamente la fila de encabezado de un CSV y devuelve los nombres de
 * columna detectados (trim aplicado, vacíos descartados). Se usa para construir
 * la UI de mapeo de columnas del formato `generic_csv` sin subir el archivo.
 */
export function parseCsvHeaders(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      preview: 1,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) =>
        resolve((results.meta.fields ?? []).map((h) => h.trim()).filter(Boolean)),
      error: (err) => reject(err),
    });
  });
}

/**
 * Parsea un archivo CSV de miembros y valida cada fila contra `inviteMemberSchema`.
 *
 * Formato esperado: header `email,role` (case-insensitive). Filas vacías se ignoran.
 * Otras columnas se descartan silenciosamente.
 *
 * Robustez (delegada a papaparse):
 *  - BOMs UTF-8 (Excel)
 *  - Saltos de línea Windows (\r\n)
 *  - Comillas, escapes, comas dentro de valores
 */
export function parseMembersCsv(file: File): Promise<ParsedMembersCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (results) => {
        const valid: InviteMemberDto[] = [];
        const errors: ParsedMembersCsv['errors'] = [];

        results.data.forEach((row, i) => {
          const parsed = inviteMemberSchema.safeParse({
            email: row.email ?? '',
            role: row.role ?? '',
          });
          if (parsed.success) {
            valid.push(parsed.data);
          } else {
            errors.push({
              row: i + 2, // header = 1, data starts at 2
              raw: row,
              message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
            });
          }
        });

        resolve({ valid, errors, totalRows: results.data.length });
      },
      error: (err) => reject(err),
    });
  });
}
