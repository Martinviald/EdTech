import { buildOmrQrPayload, parseOmrQrPayload } from './omr-qr';

const sheetId = '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33';
const hash = 'a3f9c1e70b4d2856';

describe('buildOmrQrPayload / parseOmrQrPayload', () => {
  it('ida y vuelta exacta', () => {
    const raw = buildOmrQrPayload({ printedSheetId: sheetId, layoutHash: hash, pageIndex: 0, pageCount: 2 });
    expect(raw).toBe(`academos:v1:${sheetId}:${hash}:0:2`);
    expect(parseOmrQrPayload(raw)).toEqual({
      printedSheetId: sheetId,
      layoutHash: hash,
      pageIndex: 0,
      pageCount: 2,
    });
  });

  it('tolera espacios alrededor y normaliza el hash a minúsculas', () => {
    const parsed = parseOmrQrPayload(`  academos:v1:${sheetId}:${hash.toUpperCase()}:1:2 \n`);
    expect(parsed?.layoutHash).toBe(hash);
    expect(parsed?.pageIndex).toBe(1);
  });

  it.each([
    ['prefijo ajeno', `otro:v1:${sheetId}:${hash}:0:2`],
    ['versión desconocida', `academos:v2:${sheetId}:${hash}:0:2`],
    ['uuid inválido', `academos:v1:no-un-uuid:${hash}:0:2`],
    ['hash corto', `academos:v1:${sheetId}:abc123:0:2`],
    ['pageIndex negativo', `academos:v1:${sheetId}:${hash}:-1:2`],
    ['pageIndex fuera de rango', `academos:v1:${sheetId}:${hash}:2:2`],
    ['pageCount cero', `academos:v1:${sheetId}:${hash}:0:0`],
    ['pageIndex no numérico', `academos:v1:${sheetId}:${hash}:x:2`],
    ['faltan partes', `academos:v1:${sheetId}:${hash}:0`],
    ['sobra una parte', `academos:v1:${sheetId}:${hash}:0:2:extra`],
    ['texto arbitrario', 'https://ejemplo.com/qr'],
  ])('rechaza %s', (_name, raw) => {
    expect(parseOmrQrPayload(raw)).toBeNull();
  });
});
