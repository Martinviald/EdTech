import type { Database } from '../../database/database.types';
import type { ParsedAnswerSheetRow } from './parsers/parser.types';
import { matchStudents } from './student-matcher';

interface FakeStudent {
  id: string;
  rut: string;
  firstName: string;
  lastName: string;
}

function makeDb(students: FakeStudent[]): Database {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(students),
  };
  return { select: () => chain } as unknown as Database;
}

function row(rowNumber: number, studentRut: string | null): ParsedAnswerSheetRow {
  return { rowNumber, studentRut, studentFullName: null, answers: {}, errors: [] };
}

const STUDENTS: FakeStudent[] = [
  { id: 's1', rut: '12345678-5', firstName: 'Juan', lastName: 'Pérez' },
  { id: 's2', rut: '24160232-K', firstName: 'Ana', lastName: 'Soto' },
];

describe('matchStudents', () => {
  it('matchea por RUT exacto', async () => {
    const db = makeDb(STUDENTS);
    const result = await matchStudents(db, 'org-1', [row(2, '12345678-5')]);
    const m = result.get(2)!;
    expect(m.matched).toBe(true);
    expect(m.studentId).toBe('s1');
    expect(m.matchMethod).toBe('exact');
    expect(m.rutNormalized).toBe('12345678-5');
  });

  it('recupera por cuerpo del RUT cuando el DV = K llegó como 0', async () => {
    const db = makeDb(STUDENTS);
    const result = await matchStudents(db, 'org-1', [row(2, '241602320')]);
    const m = result.get(2)!;
    expect(m.matched).toBe(true);
    expect(m.studentId).toBe('s2');
    expect(m.matchMethod).toBe('body');
    expect(m.rutNormalized).toBe('24160232-K');
  });

  it('no matchea un RUT válido ausente del roster', async () => {
    const db = makeDb(STUDENTS);
    const result = await matchStudents(db, 'org-1', [row(2, '22222222-2')]);
    const m = result.get(2)!;
    expect(m.matched).toBe(false);
    expect(m.matchMethod).toBeNull();
  });

  it('marca un RUT inválido sin tocar la BD', async () => {
    const db = makeDb([]);
    const result = await matchStudents(db, 'org-1', [row(2, 'no-es-rut')]);
    const m = result.get(2)!;
    expect(m.matched).toBe(false);
    expect(m.rutNormalized).toBeNull();
  });
});
