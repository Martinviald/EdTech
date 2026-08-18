import { and, eq, isNull, sql } from 'drizzle-orm';
import { students } from '@soe/db';
import { normalizeRut, rutBodyKey } from '@soe/types';
import type { Database } from '../../database/database.types';
import type { ParsedAnswerSheetRow } from './parsers/parser.types';

export type MatchMethod = 'exact' | 'body' | null;

export interface StudentMatch {
  rowNumber: number;
  rutNormalized: string | null;
  studentId: string | null;
  studentFullName: string | null;
  matched: boolean;
  matchMethod: MatchMethod;
}

interface StudentRecord {
  id: string;
  rut: string;
  fullName: string;
}

/**
 * Matchea filas parseadas con alumnos de la BD por RUT.
 *
 * Dos pasadas, exacto primero:
 *  1. RUT normalizado con Módulo 11 (`normalizeRut`) contra el RUT del alumno.
 *  2. Fallback por CUERPO del RUT (`rutBodyKey`): recupera los casos donde el
 *     escáner guardó mal el DV — típicamente DV = K bubbleado como `0`. El cuerpo
 *     determina el DV, así que es una clave única por alumno dentro de la org.
 *
 * Sólo alumnos de la org del caller y no soft-deleted. Una fila sin cuerpo de RUT
 * válido queda `matched=false` sin tocar la BD.
 */
export async function matchStudents(
  db: Database,
  orgId: string,
  rows: readonly ParsedAnswerSheetRow[],
): Promise<Map<number, StudentMatch>> {
  const out = new Map<number, StudentMatch>();

  const rowKeys = new Map<number, { normalized: string | null; body: string | null }>();
  const bodies = new Set<string>();
  for (const row of rows) {
    const normalized = normalizeRut(row.studentRut);
    const body = rutBodyKey(row.studentRut);
    rowKeys.set(row.rowNumber, { normalized, body });
    if (body) bodies.add(body);
  }

  const byExactRut = new Map<string, StudentRecord>();
  const byBody = new Map<string, StudentRecord>();

  if (bodies.size > 0) {
    const bodyList = sql.join(
      Array.from(bodies).map((b) => sql`${b}`),
      sql`, `,
    );
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
          sql`split_part(${students.rut}, '-', 1) in (${bodyList})`,
        ),
      );

    for (const s of found) {
      const record: StudentRecord = { id: s.id, rut: s.rut, fullName: `${s.firstName} ${s.lastName}`.trim() };
      byExactRut.set(s.rut, record);
      const body = rutBodyKey(s.rut);
      if (body && !byBody.has(body)) byBody.set(body, record);
    }
  }

  for (const row of rows) {
    const keys = rowKeys.get(row.rowNumber)!;

    let record: StudentRecord | undefined;
    let method: MatchMethod = null;
    if (keys.normalized && byExactRut.has(keys.normalized)) {
      record = byExactRut.get(keys.normalized);
      method = 'exact';
    } else if (keys.body && byBody.has(keys.body)) {
      record = byBody.get(keys.body);
      method = 'body';
    }

    out.set(row.rowNumber, {
      rowNumber: row.rowNumber,
      rutNormalized: record?.rut ?? keys.normalized,
      studentId: record?.id ?? null,
      studentFullName: record?.fullName ?? row.studentFullName,
      matched: !!record,
      matchMethod: method,
    });
  }

  return out;
}
