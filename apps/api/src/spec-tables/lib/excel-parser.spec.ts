import { parseExcelBuffer, type ParsedSheet } from './excel-parser';

describe('parseExcelBuffer', () => {
  it('parses a simple CSV string correctly', () => {
    const csv =
      'Pregunta,Habilidad,OA,Respuesta\n1,Localizar,OA1,B\n2,Interpretar,OA3,C';
    const buffer = Buffer.from(csv, 'utf-8');

    const result: ParsedSheet = parseExcelBuffer(buffer);

    expect(result.columns).toEqual([
      'Pregunta',
      'Habilidad',
      'OA',
      'Respuesta',
    ]);
    expect(result.totalRows).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      Pregunta: '1',
      Habilidad: 'Localizar',
      OA: 'OA1',
      Respuesta: 'B',
    });
    expect(result.rows[1]).toEqual({
      Pregunta: '2',
      Habilidad: 'Interpretar',
      OA: 'OA3',
      Respuesta: 'C',
    });
  });

  it('handles an empty buffer gracefully', () => {
    const buffer = Buffer.alloc(0);

    const result = parseExcelBuffer(buffer);

    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.totalRows).toBe(0);
  });

  it('extracts correct column names from CSV with varied data', () => {
    const csv = 'Número,Eje,Objetivo de Aprendizaje,Dificultad\n1,Lectura,OA1,Fácil';
    const buffer = Buffer.from(csv, 'utf-8');

    const result = parseExcelBuffer(buffer);

    expect(result.columns).toEqual([
      'Número',
      'Eje',
      'Objetivo de Aprendizaje',
      'Dificultad',
    ]);
    expect(result.totalRows).toBe(1);
  });

  it('handles CSV with empty cells using defval', () => {
    const csv = 'Pregunta,Habilidad,OA\n1,,OA2\n2,Interpretar,';
    const buffer = Buffer.from(csv, 'utf-8');

    const result = parseExcelBuffer(buffer);

    expect(result.totalRows).toBe(2);
    expect(result.rows[0]).toEqual({
      Pregunta: '1',
      Habilidad: '',
      OA: 'OA2',
    });
    expect(result.rows[1]).toEqual({
      Pregunta: '2',
      Habilidad: 'Interpretar',
      OA: '',
    });
  });

  it('handles a header-only CSV (no data rows)', () => {
    const csv = 'Col1,Col2,Col3\n';
    const buffer = Buffer.from(csv, 'utf-8');

    const result = parseExcelBuffer(buffer);

    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.totalRows).toBe(0);
  });

  it('handles CSV with special characters in values', () => {
    const csv =
      'Pregunta,Descripción\n1,"Texto con coma, y punto"\n2,"Pregunta con ""comillas"""\n';
    const buffer = Buffer.from(csv, 'utf-8');

    const result = parseExcelBuffer(buffer);

    expect(result.totalRows).toBe(2);
    expect(result.rows[0]['Descripción']).toBe('Texto con coma, y punto');
    expect(result.rows[1]['Descripción']).toBe('Pregunta con "comillas"');
  });

  it('handles CSV with many rows', () => {
    const header = 'Pregunta,Habilidad';
    const rowLines = Array.from({ length: 100 }, (_, i) => `${i + 1},Skill${i + 1}`);
    const csv = [header, ...rowLines].join('\n');
    const buffer = Buffer.from(csv, 'utf-8');

    const result = parseExcelBuffer(buffer);

    expect(result.totalRows).toBe(100);
    expect(result.columns).toEqual(['Pregunta', 'Habilidad']);
    expect(result.rows[0]).toEqual({ Pregunta: '1', Habilidad: 'Skill1' });
    expect(result.rows[99]).toEqual({ Pregunta: '100', Habilidad: 'Skill100' });
  });
});
