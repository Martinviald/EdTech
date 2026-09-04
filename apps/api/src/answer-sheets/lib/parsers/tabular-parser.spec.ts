import * as XLSX from 'xlsx';
import { parseGradecamCsv } from './gradecam-parser';
import { parseDiaOfficialCsv } from './dia-official-parser';
import { parseZipgradeCsv } from './zipgrade-parser';

const GRADECAM_AOA: string[][] = [
  [''],
  ['Student By Question'],
  ['Prueba DIA Monitoreo (Matemática) - 8 | Filtered by: Turned In'],
  ['Exported by Gradient 1 on Aug 17, 2026 7:34:40 PM'],
  ['Name', 'ID', 'GradeCam ID', '1', '2', '3'],
  ['Pérez, Juan', '12345678-5', '', 'A', '-', '0'],
  ['Soto, Ana', '241602320', '', 'B', 'C', '2'],
  ['Answers / Max Points', '', '', 'A', 'B', '2'],
];

function toCsv(aoa: string[][]): Buffer {
  const csv = aoa
    .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\n');
  return Buffer.from(csv, 'utf-8');
}

function toXlsx(aoa: string[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Student By Question');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseGradecamCsv — export real "Student By Question"', () => {
  for (const [kind, build] of [
    ['CSV', toCsv],
    ['XLSX', toXlsx],
  ] as const) {
    describe(kind, () => {
      const result = parseGradecamCsv(build(GRADECAM_AOA));

      it('salta las filas de título y detecta el header real', () => {
        expect(result.detectedColumns).toEqual(['Name', 'ID', 'GradeCam ID', '1', '2', '3']);
      });

      it('descarta la fila de pauta (Answers / Max Points)', () => {
        expect(result.rows).toHaveLength(2);
        expect(result.rows.some((r) => /answers|max points/i.test(r.studentFullName ?? ''))).toBe(false);
      });

      it('toma columnas de pregunta con número pelado', () => {
        expect(Object.keys(result.rows[0].answers)).toEqual(['1', '2', '3']);
      });

      it('usa ID como RUT, no GradeCam ID', () => {
        expect(result.rows[0].studentRut).toBe('12345678-5');
        expect(result.rows[1].studentRut).toBe('241602320');
      });

      it('arma el nombre desde "Apellido, Nombre"', () => {
        expect(result.rows[0].studentFullName).toBe('Juan Pérez');
        expect(result.rows[1].studentFullName).toBe('Ana Soto');
      });

      it('trata "-" como blanco pero preserva "0" (nivel de rúbrica)', () => {
        expect(result.rows[0].answers['2']).toBeNull();
        expect(result.rows[0].answers['3']).toBe('0');
        expect(result.rows[1].answers['3']).toBe('2');
      });

      it('no emite warnings de columnas faltantes', () => {
        expect(result.warnings).toEqual([]);
      });
    });
  }
});

describe('parseDiaOfficialCsv', () => {
  const csv = toCsv([
    ['RUT', 'Apellidos', 'Nombres', 'p1', 'p2'],
    ['12345678-5', 'Pérez Soto', 'Juan', 'A', 'B'],
  ]);
  const result = parseDiaOfficialCsv(csv);

  it('detecta preguntas con prefijo p y concatena Nombres Apellidos', () => {
    expect(Object.keys(result.rows[0].answers)).toEqual(['1', '2']);
    expect(result.rows[0].studentFullName).toBe('Juan Pérez Soto');
    expect(result.rows[0].studentRut).toBe('12345678-5');
  });
});

describe('parseZipgradeCsv', () => {
  const csv = toCsv([
    ['Student First Name', 'Student Last Name', 'Student ID', 'Q01', 'Q02'],
    ['Juan', 'Pérez', '12345678-5', 'A', 'B'],
  ]);
  const result = parseZipgradeCsv(csv);

  it('detecta preguntas con padding Q0N y arma nombre first last', () => {
    expect(Object.keys(result.rows[0].answers)).toEqual(['1', '2']);
    expect(result.rows[0].studentFullName).toBe('Juan Pérez');
    expect(result.rows[0].studentRut).toBe('12345678-5');
  });
});
