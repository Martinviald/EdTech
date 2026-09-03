import { PDFDocument } from 'pdf-lib';
import type { ItemContent, LayoutField, LayoutSpec } from '@soe/types';
import { deriveLayoutDraft, type DerivableItem } from './sheet-layout.helpers';
import {
  PAPER_SIZES_PT,
  computeDrawPlan,
  renderSheetsPdf,
  type PrintableSheetInfo,
} from './sheet-print.helpers';

const INSTRUMENT_ID = '11111111-1111-4111-8111-111111111111';
const SPEC_HASH = 'a3f9c1e70b4d2856';

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
    } as ItemContent,
  };
}

function makeSpec(itemCount = 10, paper: LayoutSpec['paper'] = 'letter'): LayoutSpec {
  const items = Array.from({ length: itemCount }, (_, i) => mcItem(i + 1));
  const spec = deriveLayoutDraft(INSTRUMENT_ID, items).spec;
  return { ...spec, paper };
}

function circleIntersectsRect(
  cx: number,
  cy: number,
  radius: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  return Math.hypot(cx - nearestX, cy - nearestY) < radius;
}

describe('computeDrawPlan', () => {
  it('ubica cada burbuja dentro de los límites de la página', () => {
    const plan = computeDrawPlan(makeSpec(75), 0);

    expect(plan.bubbles.length).toBeGreaterThan(0);
    for (const bubble of plan.bubbles) {
      expect(bubble.cx - bubble.radius).toBeGreaterThan(0);
      expect(bubble.cx + bubble.radius).toBeLessThan(plan.pageWidth);
      expect(bubble.cy - bubble.radius).toBeGreaterThan(0);
      expect(bubble.cy + bubble.radius).toBeLessThan(plan.pageHeight);
    }
  });

  it('ninguna burbuja se solapa con un fiducial de esquina', () => {
    const plan = computeDrawPlan(makeSpec(75), 0);

    for (const bubble of plan.bubbles) {
      for (const fiducial of plan.fiducials) {
        expect(circleIntersectsRect(bubble.cx, bubble.cy, bubble.radius, fiducial)).toBe(false);
      }
    }
  });

  it('sólo dibuja los fields de la página pedida', () => {
    const spec = makeSpec(80);
    const page0 = computeDrawPlan(spec, 0);
    const page1 = computeDrawPlan(spec, 1);

    const expectedPage1 = spec.fields.filter((f) => f.pageIndex === 1);
    expect(page1.bubbles).toHaveLength(expectedPage1.length * 4);
    expect(page0.bubbles).toHaveLength((spec.fields.length - expectedPage1.length) * 4);
    expect(new Set(page1.bubbles.map((b) => b.fieldId))).toEqual(
      new Set(expectedPage1.map((f) => f.fieldId)),
    );
  });

  it('la conversión preserva la coordenada normalizada relativa al marco fiducial (D7)', () => {
    const spec = makeSpec(10);
    const plan = computeDrawPlan(spec, 0);

    for (const field of spec.fields) {
      for (const bubble of field.bubbles) {
        const drawn = plan.bubbles.find(
          (b) => b.fieldId === field.fieldId && b.value === bubble.value,
        )!;
        expect((drawn.cx - plan.frame.x) / plan.frame.width).toBeCloseTo(bubble.center.x, 6);
        expect(
          (plan.pageHeight - drawn.cy - plan.frame.y) / plan.frame.height,
        ).toBeCloseTo(bubble.center.y, 6);
      }
    }
  });

  it('escala con el tamaño de papel manteniendo las fracciones del spec', () => {
    const letterPlan = computeDrawPlan(makeSpec(10, 'letter'), 0);
    const a4Plan = computeDrawPlan(makeSpec(10, 'a4'), 0);

    expect(letterPlan.pageWidth).toBe(PAPER_SIZES_PT.letter.width);
    expect(a4Plan.pageWidth).toBe(PAPER_SIZES_PT.a4.width);
    const letterBubble = letterPlan.bubbles[0]!;
    const a4Bubble = a4Plan.bubbles[0]!;
    expect((letterBubble.cx - letterPlan.frame.x) / letterPlan.frame.width).toBeCloseTo(
      (a4Bubble.cx - a4Plan.frame.x) / a4Plan.frame.width,
      6,
    );
  });

  it('el QR queda dentro de la región de identidad del spec', () => {
    const spec = makeSpec(10);
    const plan = computeDrawPlan(spec, 0);
    const region = spec.identity.region;

    const regionLeft = plan.frame.x + region.topLeft.x * plan.frame.width;
    const regionRight = plan.frame.x + region.bottomRight.x * plan.frame.width;
    const regionTopPdf = plan.pageHeight - (plan.frame.y + region.topLeft.y * plan.frame.height);
    const regionBottomPdf =
      plan.pageHeight - (plan.frame.y + region.bottomRight.y * plan.frame.height);

    expect(plan.qr.size).toBeGreaterThan(0);
    expect(plan.qr.x).toBeGreaterThanOrEqual(regionLeft - 1e-6);
    expect(plan.qr.x + plan.qr.size).toBeLessThanOrEqual(regionRight + 1e-6);
    expect(plan.qr.y).toBeGreaterThanOrEqual(regionBottomPdf - 1e-6);
    expect(plan.qr.y + plan.qr.size).toBeLessThanOrEqual(regionTopPdf + 1e-6);
  });

  it('dibuja una marca de sincronía por fila de burbujas', () => {
    const spec = makeSpec(30);
    const plan = computeDrawPlan(spec, 0);

    const distinctRows = new Set(plan.bubbles.map((b) => Math.round(b.cy * 10) / 10));
    expect(plan.syncTicks).toHaveLength(distinctRows.size);
  });
});

describe('renderSheetsPdf', () => {
  const sheets: PrintableSheetInfo[] = [
    {
      printedSheetId: '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33',
      sequence: 1,
      shortCode: 0x0a1b2c3d,
      studentName: 'Pérez, Ana',
      classGroupName: '3° Básico A',
    },
    {
      printedSheetId: '8e1b0933-2a6d-4b00-8c9c-4d7e6a1b0c22',
      sequence: 2,
      shortCode: 0x0a1b2c3e,
      studentName: null,
      classGroupName: '3° Básico A',
    },
  ];

  it('produce pageCount × hojas páginas', async () => {
    const spec = makeSpec(80);
    expect(spec.pageCount).toBe(2);

    const bytes = await renderSheetsPdf(spec, SPEC_HASH, sheets);
    const doc = await PDFDocument.load(bytes);

    expect(doc.getPageCount()).toBe(spec.pageCount * sheets.length);
  });

  it('produce un PDF válido con las dimensiones del papel del spec', async () => {
    const spec = makeSpec(5);
    const bytes = await renderSheetsPdf(spec, SPEC_HASH, sheets);

    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(PAPER_SIZES_PT.letter.width, 2);
    expect(page.getHeight()).toBeCloseTo(PAPER_SIZES_PT.letter.height, 2);
  });
});

function digitGridField(printedNumber: string, digitCount: number, topY: number): LayoutField {
  const bubbles: LayoutField['bubbles'] = [];
  for (let group = 0; group < digitCount; group++) {
    for (let digit = 0; digit <= 9; digit++) {
      bubbles.push({
        value: String(digit),
        center: { x: 0.6 + group * 0.05, y: topY + digit * 0.02 },
        radius: 0.008,
        group,
      });
    }
  }
  return {
    fieldId: `f_${printedNumber}`,
    kind: 'digit_grid',
    printedNumber,
    pageIndex: 0,
    selectMode: 'single',
    bubbles,
    region: null,
  };
}

function cropRegionField(printedNumber: string): LayoutField {
  return {
    fieldId: `f_${printedNumber}`,
    kind: 'crop_region',
    printedNumber,
    pageIndex: 0,
    selectMode: 'single',
    bubbles: [],
    region: { topLeft: { x: 0.55, y: 0.7 }, bottomRight: { x: 0.95, y: 0.9 } },
  };
}

describe('computeDrawPlan — campos digit_grid y crop_region (CD-8/CD-9)', () => {
  it('dibuja cada burbuja de un digit_grid con su dígito y el número de pregunta', () => {
    const base = makeSpec(5);
    const grid = digitGridField('21', 3, 0.3);
    const spec: LayoutSpec = { ...base, fields: [...base.fields, grid] };

    const plan = computeDrawPlan(spec, 0);

    const gridBubbles = plan.bubbles.filter((b) => b.fieldId === grid.fieldId);
    expect(gridBubbles).toHaveLength(30);
    expect(new Set(gridBubbles.map((b) => b.value))).toEqual(
      new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']),
    );
    for (const bubble of gridBubbles) {
      expect(bubble.printedNumber).toBe('21');
      expect(bubble.cx - bubble.radius).toBeGreaterThan(0);
      expect(bubble.cx + bubble.radius).toBeLessThan(plan.pageWidth);
      expect(bubble.cy - bubble.radius).toBeGreaterThan(0);
      expect(bubble.cy + bubble.radius).toBeLessThan(plan.pageHeight);
    }
    expect(plan.labels.some((l) => l.text === '21')).toBe(true);
  });

  it('dibuja un crop_region como recuadro con su número de pregunta (D7)', () => {
    const base = makeSpec(5);
    const crop = cropRegionField('22');
    const spec: LayoutSpec = { ...base, fields: [...base.fields, crop] };

    const plan = computeDrawPlan(spec, 0);

    expect(plan.cropRegions).toHaveLength(1);
    const drawn = plan.cropRegions[0]!;
    expect(drawn.printedNumber).toBe('22');
    expect((drawn.rect.x - plan.frame.x) / plan.frame.width).toBeCloseTo(0.55, 6);
    expect(
      (plan.pageHeight - (drawn.rect.y + drawn.rect.height) - plan.frame.y) / plan.frame.height,
    ).toBeCloseTo(0.7, 6);
    expect(drawn.rect.width / plan.frame.width).toBeCloseTo(0.4, 6);
    expect(drawn.rect.height / plan.frame.height).toBeCloseTo(0.2, 6);
  });

  it('no incluye crop_regions de otra página ni en specs sin ellos', () => {
    const plan = computeDrawPlan(makeSpec(10), 0);
    expect(plan.cropRegions).toEqual([]);
  });

  it('renderSheetsPdf con digit_grid y crop_region produce un PDF válido', async () => {
    const base = makeSpec(5);
    const spec: LayoutSpec = {
      ...base,
      fields: [...base.fields, digitGridField('21', 3, 0.3), cropRegionField('22')],
    };

    const bytes = await renderSheetsPdf(spec, SPEC_HASH, [
      {
        printedSheetId: '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33',
        sequence: 1,
        shortCode: 0x0a1b2c3d,
        studentName: 'Pérez, Ana',
        classGroupName: '3° Básico A',
      },
    ]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('computeDrawPlan — hoja genérica con RUT (CD-10)', () => {
  function makeRutSpec(itemCount = 10): LayoutSpec {
    const items = Array.from({ length: itemCount }, (_, i) => mcItem(i + 1));
    return deriveLayoutDraft(INSTRUMENT_ID, items, 'rut_bubbles').spec;
  }

  it('dibuja la grilla RUT completa dentro de la página, sin chocar con las burbujas de respuesta', () => {
    const spec = makeRutSpec(30);
    const plan = computeDrawPlan(spec, 0);

    expect(plan.rutGridBubbles).toHaveLength((spec.identity.bubbles ?? []).length);
    for (const bubble of plan.rutGridBubbles) {
      expect(bubble.cx - bubble.radius).toBeGreaterThan(0);
      expect(bubble.cx + bubble.radius).toBeLessThan(plan.pageWidth);
      expect(bubble.cy - bubble.radius).toBeGreaterThan(0);
      expect(bubble.cy + bubble.radius).toBeLessThan(plan.pageHeight);
    }

    const gridBottom = Math.min(...plan.rutGridBubbles.map((b) => b.cy - b.radius));
    const answersTop = Math.max(...plan.bubbles.map((b) => b.cy + b.radius));
    expect(answersTop).toBeLessThan(gridBottom);
  });

  it('mantiene el QR propio de cada hoja (D13) fuera de la grilla RUT e incluye instrucciones', () => {
    const plan = computeDrawPlan(makeRutSpec(10), 0);

    expect(plan.qr.size).toBeGreaterThan(0);
    const gridRight = Math.max(...plan.rutGridBubbles.map((b) => b.cx + b.radius));
    expect(plan.qr.x).toBeGreaterThan(gridRight);
    expect(plan.instructions.length).toBeGreaterThan(0);
    expect(plan.instructions.map((i) => i.text).join(' ')).toContain('RUT');
  });

  it('el modo qr no gana grilla ni instrucciones (regresión MVP)', () => {
    const plan = computeDrawPlan(makeSpec(10), 0);

    expect(plan.rutGridBubbles).toEqual([]);
    expect(plan.instructions).toEqual([]);
  });

  it('renderSheetsPdf de hojas genéricas produce un PDF válido con QR por copia', async () => {
    const spec = makeRutSpec(5);
    const genericSheets: PrintableSheetInfo[] = [
      {
        printedSheetId: '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33',
        sequence: 1,
        shortCode: 0x0a1b2c3d,
        studentName: null,
        classGroupName: '3° Básico A',
      },
      {
        printedSheetId: '8e1b0933-2a6d-4b00-8c9c-4d7e6a1b0c22',
        sequence: 2,
        shortCode: 0x0a1b2c3e,
        studentName: null,
        classGroupName: '3° Básico A',
      },
    ];

    const bytes = await renderSheetsPdf(spec, SPEC_HASH, genericSheets);
    const doc = await PDFDocument.load(bytes);

    expect(doc.getPageCount()).toBe(spec.pageCount * genericSheets.length);
  });
});
