import { and, eq, inArray, isNull } from 'drizzle-orm';
import { students } from '@soe/db';
import { normalizeRut } from '@soe/types';
import type { Database } from '../../database/database.types';
import type { ParsedAnswerSheetRow } from './parsers/parser.types';

export interface StudentMatch {
  rowNumber: number;
  rutNormalized: string | null;
  studentId: string | null;
  studentFullName: string | null;
  matched: boolean;
}

/**
 * Matchea filas parseadas con alumnos de la BD por RUT.
 *
 * Reglas:
 *  - El RUT se normaliza con `normalizeRut` (módulo 11 chileno). Si la
 *    normalización falla, la fila queda `matched=false` sin tocar la BD.
 *  - Sólo se consideran alumnos de la org del caller (`org_id = orgId`).
 *  - Se excluyen alumnos soft-deleted (`deleted_at IS NULL`).
 */
export async function matchStudents(
  db: Database,
  orgId: string,
  rows: readonly ParsedAnswerSheetRow[],
): Promise<Map<number, StudentMatch>> {
  const out = new Map<number, StudentMatch>();
  const rutToRows = new Map<string, number[]>();

  for (const row of rows) {
    const normalized = normalizeRut(row.studentRut);
    if (!normalized) {
      out.set(row.rowNumber, {
        rowNumber: row.rowNumber,
        rutNormalized: null,
        studentId: null,
        studentFullName: row.studentFullName,
        matched: false,
      });
      continue;
    }
    const list = rutToRows.get(normalized) ?? [];
    list.push(row.rowNumber);
    rutToRows.set(normalized, list);
  }

  const allRuts = Array.from(rutToRows.keys());
  if (allRuts.length === 0) return out;

  const found = await db
    .select({
      id: students.id,
      rut: students.rut,
      firstName: students.firstName,
      lastName: students.lastName,
    })
    .from(students)
    .where(
      and(
        eq(students.orgId, orgId),
        isNull(students.deletedAt),
        inArray(students.rut, allRuts),
      ),
    );

  const studentByRut = new Map<string, { id: string; fullName: string }>();
  for (const s of found) {
    studentByRut.set(s.rut, {
      id: s.id,
      fullName: `${s.firstName} ${s.lastName}`.trim(),
    });
  }

  for (const [rut, rowNumbers] of rutToRows.entries()) {
    const match = studentByRut.get(rut);
    for (const rowNumber of rowNumbers) {
      // Recuperar el fullName parseado original si el alumno no se encontró.
      const originalRow = rows.find((r) => r.rowNumber === rowNumber);
      out.set(rowNumber, {
        rowNumber,
        rutNormalized: rut,
        studentId: match?.id ?? null,
        studentFullName: match?.fullName ?? originalRow?.studentFullName ?? null,
        matched: !!match,
      });
    }
  }

  return out;
}
