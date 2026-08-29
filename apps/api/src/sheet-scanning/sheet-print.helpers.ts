import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { buildOmrQrPayload, type LayoutSpec } from '@soe/types';

export const PAPER_SIZES_PT: Record<LayoutSpec['paper'], { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
  legal: { width: 612, height: 1008 },
};

export interface DrawPlanRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawPlanBubble {
  fieldId: string;
  printedNumber: string;
  value: string;
  cx: number;
  cy: number;
  radius: number;
}

export interface DrawPlanLabel {
  text: string;
  x: number;
  y: number;
}

export interface SheetDrawPlan {
  pageWidth: number;
  pageHeight: number;
  frame: DrawPlanRect;
  fiducials: DrawPlanRect[];
  bubbles: DrawPlanBubble[];
  labels: DrawPlanLabel[];
  syncTicks: DrawPlanRect[];
  qr: { x: number; y: number; size: number };
  header: { nameX: number; nameY: number; courseX: number; courseY: number };
}

export interface PrintableSheetInfo {
  printedSheetId: string;
  sequence: number;
  studentName: string | null;
  classGroupName: string | null;
}

const SYNC_TICK_HEIGHT = 1.6;
const LABEL_FONT_SIZE = 8;
const LABEL_GAP = 6;
const NAME_FONT_SIZE = 11;
const COURSE_FONT_SIZE = 9;
const BLANK_NAME_LINE = '________________________________';

export function computeDrawPlan(spec: LayoutSpec, pageIndex: number): SheetDrawPlan {
  const { width: pageWidth, height: pageHeight } = PAPER_SIZES_PT[spec.paper];
  const fiducialSide = spec.fiducials.sizeRatio * pageWidth;
  const fiducialMargin = spec.fiducials.marginRatio * pageWidth;

  const frameLeft = fiducialMargin + fiducialSide / 2;
  const frameTop = fiducialMargin + fiducialSide / 2;
  const frameWidth = pageWidth - 2 * frameLeft;
  const frameHeight = pageHeight - 2 * frameTop;

  const toX = (nx: number): number => frameLeft + nx * frameWidth;
  const toY = (ny: number): number => pageHeight - (frameTop + ny * frameHeight);

  const fiducials: DrawPlanRect[] = [
    { x: fiducialMargin, y: pageHeight - fiducialMargin - fiducialSide, width: fiducialSide, height: fiducialSide },
    { x: pageWidth - fiducialMargin - fiducialSide, y: pageHeight - fiducialMargin - fiducialSide, width: fiducialSide, height: fiducialSide },
    { x: fiducialMargin, y: fiducialMargin, width: fiducialSide, height: fiducialSide },
    { x: pageWidth - fiducialMargin - fiducialSide, y: fiducialMargin, width: fiducialSide, height: fiducialSide },
  ];

  const bubbles: DrawPlanBubble[] = [];
  const labels: DrawPlanLabel[] = [];
  const rowCenters = new Set<number>();

  for (const field of spec.fields) {
    if (field.pageIndex !== pageIndex) continue;
    let minCx = Number.POSITIVE_INFINITY;
    let rowCy = 0;
    let radiusPt = 0;
    for (const bubble of field.bubbles) {
      const cx = toX(bubble.center.x);
      const cy = toY(bubble.center.y);
      const radius = bubble.radius * frameWidth;
      bubbles.push({
        fieldId: field.fieldId,
        printedNumber: field.printedNumber,
        value: bubble.value,
        cx,
        cy,
        radius,
      });
      if (cx < minCx) {
        minCx = cx;
        rowCy = cy;
        radiusPt = radius;
      }
    }
    if (field.bubbles.length > 0) {
      labels.push({
        text: field.printedNumber,
        x: minCx - radiusPt - LABEL_GAP - LABEL_FONT_SIZE * 0.6 * field.printedNumber.length,
        y: rowCy - LABEL_FONT_SIZE * 0.35,
      });
      rowCenters.add(Math.round(rowCy * 10) / 10);
    }
  }

  const syncTicks: DrawPlanRect[] = Array.from(rowCenters)
    .sort((a, b) => b - a)
    .map((cy) => ({
      x: fiducialMargin,
      y: cy - SYNC_TICK_HEIGHT / 2,
      width: fiducialSide * 0.6,
      height: SYNC_TICK_HEIGHT,
    }));

  const region = spec.identity.region;
  const regionWidth = (region.bottomRight.x - region.topLeft.x) * frameWidth;
  const regionHeight = (region.bottomRight.y - region.topLeft.y) * frameHeight;
  const qrSize = Math.max(Math.min(regionWidth, regionHeight), 1);
  const qrX = toX(region.topLeft.x) + (regionWidth - qrSize) / 2;
  const qrY = toY(region.bottomRight.y) + (regionHeight - qrSize) / 2;

  return {
    pageWidth,
    pageHeight,
    frame: { x: frameLeft, y: frameTop, width: frameWidth, height: frameHeight },
    fiducials,
    bubbles,
    labels,
    syncTicks,
    qr: { x: qrX, y: qrY, size: qrSize },
    header: {
      nameX: toX(0.02),
      nameY: toY(0.05),
      courseX: toX(0.02),
      courseY: toY(0.09),
    },
  };
}

export async function renderSheetsPdf(
  spec: LayoutSpec,
  specHash: string,
  sheets: readonly PrintableSheetInfo[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const plans: SheetDrawPlan[] = [];
  for (let pageIndex = 0; pageIndex < spec.pageCount; pageIndex++) {
    plans.push(computeDrawPlan(spec, pageIndex));
  }

  const black = rgb(0, 0, 0);
  const grey = rgb(0.45, 0.45, 0.45);

  for (const sheet of sheets) {
    for (let pageIndex = 0; pageIndex < spec.pageCount; pageIndex++) {
      const plan = plans[pageIndex]!;
      const page = doc.addPage([plan.pageWidth, plan.pageHeight]);

      for (const fiducial of plan.fiducials) {
        page.drawRectangle({ ...fiducial, color: black });
      }
      for (const tick of plan.syncTicks) {
        page.drawRectangle({ ...tick, color: black });
      }

      for (const bubble of plan.bubbles) {
        page.drawCircle({
          x: bubble.cx,
          y: bubble.cy,
          size: bubble.radius,
          borderColor: black,
          borderWidth: 0.8,
        });
        const valueSize = Math.max(bubble.radius * 1.1, 4);
        const valueWidth = font.widthOfTextAtSize(bubble.value, valueSize);
        page.drawText(bubble.value, {
          x: bubble.cx - valueWidth / 2,
          y: bubble.cy - valueSize * 0.36,
          size: valueSize,
          font,
          color: grey,
        });
      }

      for (const label of plan.labels) {
        page.drawText(label.text, {
          x: label.x,
          y: label.y,
          size: LABEL_FONT_SIZE,
          font: boldFont,
          color: black,
        });
      }

      const payload = buildOmrQrPayload({
        printedSheetId: sheet.printedSheetId,
        layoutHash: specHash,
        pageIndex,
        pageCount: spec.pageCount,
      });
      const qrPng = await QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', margin: 0 });
      const qrImage = await doc.embedPng(qrPng);
      page.drawImage(qrImage, {
        x: plan.qr.x,
        y: plan.qr.y,
        width: plan.qr.size,
        height: plan.qr.size,
      });

      const name = sheet.studentName ?? BLANK_NAME_LINE;
      page.drawText(name, {
        x: plan.header.nameX,
        y: plan.header.nameY,
        size: NAME_FONT_SIZE,
        font: boldFont,
        color: black,
      });

      const courseLine =
        sheet.studentName === null
          ? ['Hoja de reserva', sheet.classGroupName].filter(Boolean).join(' — ')
          : (sheet.classGroupName ?? '');
      if (courseLine.length > 0) {
        page.drawText(courseLine, {
          x: plan.header.courseX,
          y: plan.header.courseY,
          size: COURSE_FONT_SIZE,
          font,
          color: black,
        });
      }
    }
  }

  return doc.save();
}
