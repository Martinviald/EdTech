import * as QRCode from 'qrcode';
import { buildOmrQrPayload, buildOmrShortQrPayload } from '@soe/types';
import { qrPayloadForSheet } from './sheet-print.helpers';

const SHEET_ID = '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33';
const HASH = 'a3f9c1e70b4d2856';

describe('gate F2: versión del QR medida con la librería real', () => {
  it('el payload corto más largo posible cabe en versión 1 (21×21) con ECC Q', () => {
    const longest = buildOmrShortQrPayload({ shortCode: 0xffffffff, pageIndex: 15 });
    const qr = QRCode.create(longest, { errorCorrectionLevel: 'Q' });
    expect(qr.version).toBe(1);
    expect(qr.modules.size).toBe(21);
  });

  it('el payload completo legado fuerza versión 5 (37×37): la zona de aliasing que motivó el cambio', () => {
    const legacy = buildOmrQrPayload({
      printedSheetId: SHEET_ID,
      layoutHash: HASH,
      pageIndex: 0,
      pageCount: 1,
    });
    const qr = QRCode.create(legacy, { errorCorrectionLevel: 'M' });
    expect(qr.version).toBe(5);
    expect(qr.modules.size).toBe(37);
  });
});

describe('qrPayloadForSheet', () => {
  it('con short_code imprime el payload corto', () => {
    const payload = qrPayloadForSheet(
      { printedSheetId: SHEET_ID, shortCode: 0x0a1b2c3d },
      HASH,
      0,
      2,
    );
    expect(payload).toBe('AC:0A1B2C3D:0');
  });

  it('sin short_code (hoja impresa antes del formato corto) cae al payload completo', () => {
    const payload = qrPayloadForSheet({ printedSheetId: SHEET_ID, shortCode: null }, HASH, 1, 2);
    expect(payload).toBe(`academos:v1:${SHEET_ID}:${HASH}:1:2`);
  });
});
