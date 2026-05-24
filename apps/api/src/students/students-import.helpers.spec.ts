import { normalizeRut, parseCursoLabel } from '@soe/types';
import { chunk, parseStudentRosterCsv, REQUIRED_HEADERS } from './students-import.helpers';

describe('normalizeRut', () => {
  it.each([
    ['12.345.678-5', '12345678-5'],
    ['12345678-5', '12345678-5'],
    ['123456785', '12345678-5'],
    ['12.345.678-K', null], // DV incorrecto para ese cuerpo
    ['9.876.543-3', '9876543-3'],
    ['9876543k', null], // DV minúscula pero incorrecta para ese cuerpo
  ])('normaliza %s → %s', (input, expected) => {
    expect(normalizeRut(input)).toBe(expected);
  });

  it('retorna null para vacío y formatos inválidos', () => {
    expect(normalizeRut('')).toBeNull();
    expect(normalizeRut(null)).toBeNull();
    expect(normalizeRut(undefined)).toBeNull();
    expect(normalizeRut('abc')).toBeNull();
    expect(normalizeRut('123')).toBeNull();
  });

  it('valida un RUT con DV K correctamente', () => {
    // 12.345.670-K es matemáticamente correcto (DV = 10 → K)
    expect(normalizeRut('12345670-K')).toBe('12345670-K');
    expect(normalizeRut('12.345.670-k')).toBe('12345670-K');
  });
});

describe('parseCursoLabel', () => {
  it.each([
    ['1° Medio A', '1ST_MEDIO', 'A'],
    ['1 Medio A', '1ST_MEDIO', 'A'],
    ['1M A', '1ST_MEDIO', 'A'],
    ['1MA', '1ST_MEDIO', 'A'],
    ['1°MA', '1ST_MEDIO', 'A'],
    ['4° medio b', '4TH_MEDIO', 'B'],
    ['8° Básico C', '8TH_BASIC', 'C'],
    ['8 Basico C', '8TH_BASIC', 'C'],
    ['Kinder A', 'KINDER', 'A'],
    ['Pre-Kinder B', 'PRE_KINDER', 'B'],
  ])('parses %s → %s %s', (input, gradeCode, section) => {
    const result = parseCursoLabel(input);
    expect(result).not.toBeNull();
    expect(result!.gradeCode).toBe(gradeCode);
    expect(result!.section).toBe(section);
  });

  it('retorna null para etiquetas no reconocibles', () => {
    expect(parseCursoLabel('')).toBeNull();
    expect(parseCursoLabel('XYZ')).toBeNull();
    expect(parseCursoLabel('9 Medio A')).toBeNull(); // no existe 9° Medio
  });
});

describe('parseStudentRosterCsv', () => {
  it('valida headers y parsea filas válidas', () => {
    const csv = `RUT,Nombres,Apellidos,Curso
12345678-5,Juan,Pérez,1° Medio A
9876543-3,María,González,1° Medio B`;
    const result = parseStudentRosterCsv(Buffer.from(csv));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.RUT).toBe('12345678-5');
    expect(result.rows[1]!.Curso).toBe('1° Medio B');
  });

  it('reporta headers faltantes', () => {
    const csv = `RUT,Nombre,Apellido,Course
12345678-5,Juan,Pérez,1° Medio A`;
    const result = parseStudentRosterCsv(Buffer.from(csv));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingHeaders).toEqual(
      expect.arrayContaining(['Nombres', 'Apellidos', 'Curso']),
    );
  });

  it('soporta BOM al inicio del archivo', () => {
    const csv = `﻿RUT,Nombres,Apellidos,Curso
12345678-5,Juan,Pérez,1° Medio A`;
    const result = parseStudentRosterCsv(Buffer.from(csv));
    expect(result.ok).toBe(true);
  });

  it('ignora filas vacías', () => {
    const csv = `RUT,Nombres,Apellidos,Curso
12345678-5,Juan,Pérez,1° Medio A

,,,
9876543-3,María,González,1° Medio B`;
    const result = parseStudentRosterCsv(Buffer.from(csv));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Empty rows are dropped or stripped to {}
    const nonEmpty = result.rows.filter((r) => r.RUT || r.Nombres);
    expect(nonEmpty).toHaveLength(2);
  });
});

describe('chunk', () => {
  it('parte un array en bloques del tamaño indicado', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
    expect(chunk([], 5)).toEqual([]);
  });
});

describe('REQUIRED_HEADERS', () => {
  it('exporta los headers exactos esperados por la plantilla', () => {
    expect([...REQUIRED_HEADERS]).toEqual(['RUT', 'Nombres', 'Apellidos', 'Curso']);
  });
});
