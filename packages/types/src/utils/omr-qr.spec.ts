import {
  buildOmrQrPayload,
  buildOmrShortQrPayload,
  formatShortCode,
  parseOmrQrPayload,
  parseShortCodeText,
} from './omr-qr';

const sheetId = '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33';
const hash = 'a3f9c1e70b4d2856';

describe('buildOmrQrPayload / parseOmrQrPayload (formato completo, legado)', () => {
  it('ida y vuelta exacta', () => {
    const raw = buildOmrQrPayload({ printedSheetId: sheetId, layoutHash: hash, pageIndex: 0, pageCount: 2 });
    expect(raw).toBe(`academos:v1:${sheetId}:${hash}:0:2`);
    expect(parseOmrQrPayload(raw)).toEqual({
      kind: 'full',
      printedSheetId: sheetId,
      layoutHash: hash,
      pageIndex: 0,
      pageCount: 2,
    });
  });

  it('tolera espacios alrededor y normaliza el hash a minúsculas', () => {
    const parsed = parseOmrQrPayload(`  academos:v1:${sheetId}:${hash.toUpperCase()}:1:2 \n`);
    expect(parsed?.kind).toBe('full');
    expect(parsed?.kind === 'full' && parsed.layoutHash).toBe(hash);
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

describe('buildOmrShortQrPayload / parseOmrQrPayload (formato corto)', () => {
  it('ida y vuelta exacta, hex en mayúsculas con padding', () => {
    const raw = buildOmrShortQrPayload({ shortCode: 0x0a1b2c3d, pageIndex: 0 });
    expect(raw).toBe('AC:0A1B2C3D:0');
    expect(parseOmrQrPayload(raw)).toEqual({ kind: 'short', shortCode: 0x0a1b2c3d, pageIndex: 0 });
  });

  it('la forma más larga cabe en la capacidad alfanumérica de un QR v1 con ECC Q (16)', () => {
    const raw = buildOmrShortQrPayload({ shortCode: 0xffffffff, pageIndex: 15 });
    expect(raw).toBe('AC:FFFFFFFF:15');
    expect(raw.length).toBeLessThanOrEqual(16);
    expect(/^[0-9A-Z $%*+\-./:]+$/.test(raw)).toBe(true);
  });

  it('rechaza códigos fuera del rango de 32 bits', () => {
    expect(() => buildOmrShortQrPayload({ shortCode: 0, pageIndex: 0 })).toThrow();
    expect(() => buildOmrShortQrPayload({ shortCode: 0x100000000, pageIndex: 0 })).toThrow();
    expect(() => buildOmrShortQrPayload({ shortCode: 1.5, pageIndex: 0 })).toThrow();
  });

  it.each([
    ['hex en minúsculas (fuera del charset alfanumérico del QR)', 'AC:0a1b2c3d:0'],
    ['código de 7 dígitos', 'AC:0A1B2C3:0'],
    ['código de 9 dígitos', 'AC:0A1B2C3D9:0'],
    ['código cero', 'AC:00000000:0'],
    ['sin página', 'AC:0A1B2C3D'],
    ['página de 3 dígitos', 'AC:0A1B2C3D:100'],
    ['prefijo ajeno', 'XX:0A1B2C3D:0'],
  ])('rechaza %s', (_name, raw) => {
    expect(parseOmrQrPayload(raw)).toBeNull();
  });
});

describe('formatShortCode / parseShortCodeText', () => {
  it('formatea con guión para tipeo humano y vuelve', () => {
    expect(formatShortCode(0x0a1b2c3d)).toBe('0A1B-2C3D');
    expect(parseShortCodeText('0A1B-2C3D')).toBe(0x0a1b2c3d);
    expect(parseShortCodeText(' 0a1b 2c3d ')).toBe(0x0a1b2c3d);
  });

  it('rechaza texto que no es un código', () => {
    expect(parseShortCodeText('')).toBeNull();
    expect(parseShortCodeText('ZZZZ-ZZZZ')).toBeNull();
    expect(parseShortCodeText('0')).toBeNull();
    expect(parseShortCodeText('123456789A')).toBeNull();
  });
});
