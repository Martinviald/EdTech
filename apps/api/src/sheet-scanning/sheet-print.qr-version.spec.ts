import * as QRCode from 'qrcode';
import { buildOmrQrPayload, buildOmrShortQrPayload } from '@soe/types';
import { deriveLayoutDraft, type DerivableItem } from './sheet-layout.helpers';
import { computeDrawPlan, qrPayloadForSheet } from './sheet-print.helpers';

const SHEET_ID = '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33';
const HASH = 'a3f9c1e70b4d2856';
const INSTRUMENT_ID = '11111111-2222-4333-8444-555555555555';
const PT_TO_MM = 25.4 / 72;
const SCAN_DPI = 240;
const MIN_PX_PER_MODULE = 12;

function mcItem(position: number): DerivableItem {
  return {
    id: `item-${position}`,
    position,
    printedNumber: null,
    type: 'multiple_choice',
    content: {
      stem: `Pregunta ${position}`,
      alternatives: ['A', 'B', 'C', 'D'].map((key) => ({
        key,
        text: `Alt ${key}`,
        isCorrect: key === 'A',
      })),
    },
  };
}

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

describe('gate F3/F4: guardarraíl de resolución — todo QR derivado imprime ≥ 12 px/módulo a 240 dpi', () => {
  const items = Array.from({ length: 60 }, (_, i) => mcItem(i + 1));
  const worstPayload = buildOmrShortQrPayload({ shortCode: 0xffffffff, pageIndex: 15 });
  const modules = QRCode.create(worstPayload, { errorCorrectionLevel: 'Q' }).modules.size;

  it.each([['qr' as const], ['rut_bubbles' as const]])(
    'layout derivado en modo %s, con la franja del código reservada',
    (mode) => {
      const draft = deriveLayoutDraft(INSTRUMENT_ID, items, mode);
      const plan = computeDrawPlan(draft.spec, 0, { reserveShortCodeStrip: true });
      const moduleMm = (plan.qr.size * PT_TO_MM) / modules;
      const pxPerModule = (moduleMm / 25.4) * SCAN_DPI;
      expect(pxPerModule).toBeGreaterThanOrEqual(MIN_PX_PER_MODULE);
    },
  );

  it('el QR no invade la grilla de respuestas ni el fiducial superior derecho', () => {
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items, 'qr');
    const plan = computeDrawPlan(draft.spec, 0, { reserveShortCodeStrip: true });
    const qrTopPdf = plan.qr.y + plan.qr.size;
    const qrBottomPdf = plan.qr.y - 11;

    for (const bubble of plan.bubbles) {
      const overlapsX =
        bubble.cx + bubble.radius >= plan.qr.x &&
        bubble.cx - bubble.radius <= plan.qr.x + plan.qr.size;
      const overlapsY = bubble.cy + bubble.radius >= qrBottomPdf && bubble.cy - bubble.radius <= qrTopPdf;
      expect(overlapsX && overlapsY).toBe(false);
    }
    for (const fiducial of plan.fiducials) {
      const overlapsX =
        fiducial.x + fiducial.width >= plan.qr.x && fiducial.x <= plan.qr.x + plan.qr.size;
      const overlapsY = fiducial.y + fiducial.height >= plan.qr.y && fiducial.y <= qrTopPdf;
      expect(overlapsX && overlapsY).toBe(false);
    }
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
