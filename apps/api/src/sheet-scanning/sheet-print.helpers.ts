import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import {
  buildOmrQrPayload,
  buildOmrShortQrPayload,
  formatSheetDayMonthYear,
  formatShortCode,
  type LayoutSpec,
} from '@soe/types';
import { identityModeOf, SHEET_QR_IDENTITY_REGION } from './sheet-layout.helpers';

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
  group: number | null;
  cx: number;
  cy: number;
  radius: number;
}

export interface DrawPlanLabel {
  text: string;
  x: number;
  y: number;
}

export interface DrawPlanCropRegion {
  printedNumber: string;
  rect: DrawPlanRect;
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
  headerMaxWidth: { name: number; course: number };
  rutGridBubbles: DrawPlanBubble[];
  instructions: DrawPlanLabel[];
  cropRegions: DrawPlanCropRegion[];
}

export interface PrintableSheetInfo {
  printedSheetId: string;
  sequence: number;
  shortCode: number | null;
  studentName: string | null;
  classGroupName: string | null;
  listNumber: number | null;
  instrumentLabel: string | null;
  administeredAt: string | Date | null;
}

export interface InstrumentLabelParts {
  name: string;
  subjectName: string | null;
  gradeName: string | null;
  year: number | null;
  applicationPeriod: string | null;
}

const APPLICATION_PERIOD_LABELS: Record<string, string> = {
  diagnostico: 'Diagnóstico',
  intermedio: 'Monitoreo Intermedio',
  cierre: 'Cierre',
};

function normalizeForComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function appendIfMissing(base: string, addition: string | null): string {
  if (addition === null) return base;
  const trimmed = addition.trim();
  if (trimmed.length === 0) return base;
  const normalizedAddition = normalizeForComparison(trimmed);
  if (normalizedAddition.length === 0) return base;
  if (normalizeForComparison(base).includes(normalizedAddition)) return base;
  return `${base} · ${trimmed}`;
}

export function buildInstrumentLabel(parts: InstrumentLabelParts): string {
  const period = parts.applicationPeriod
    ? (APPLICATION_PERIOD_LABELS[parts.applicationPeriod] ?? parts.applicationPeriod)
    : null;

  let label = parts.name.trim();
  label = appendIfMissing(label, parts.subjectName);
  label = appendIfMissing(label, parts.gradeName);
  label = appendIfMissing(label, parts.year === null ? null : String(parts.year));

  if (period === null) return label;
  if (normalizeForComparison(label).includes(normalizeForComparison(period))) return label;
  return `${label} — ${period}`;
}

function joinHeaderParts(parts: readonly (string | null)[]): string {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' · ');
}

export function buildSheetIdentityLine(sheet: PrintableSheetInfo): string {
  if (sheet.studentName === null) {
    return joinHeaderParts([sheet.classGroupName, 'Reserva']);
  }
  return joinHeaderParts([
    sheet.classGroupName,
    sheet.listNumber === null ? null : `N° ${sheet.listNumber}`,
    sheet.studentName,
  ]);
}

export function buildSheetContextLine(
  sheet: PrintableSheetInfo,
  options: { includeClassGroup: boolean } = { includeClassGroup: false },
): string {
  return joinHeaderParts([
    options.includeClassGroup ? sheet.classGroupName : null,
    sheet.instrumentLabel,
    formatSheetDayMonthYear(sheet.administeredAt),
  ]);
}

export function fitTextToWidth(
  text: string,
  maxWidth: number,
  widthOf: (value: string) => number,
): string {
  if (text.length === 0 || widthOf(text) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && widthOf(`${truncated}…`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated.trimEnd()}…`;
}

export function qrPayloadForSheet(
  sheet: Pick<PrintableSheetInfo, 'printedSheetId' | 'shortCode'>,
  specHash: string,
  pageIndex: number,
  pageCount: number,
): string {
  if (sheet.shortCode !== null) {
    return buildOmrShortQrPayload({ shortCode: sheet.shortCode, pageIndex });
  }
  return buildOmrQrPayload({
    printedSheetId: sheet.printedSheetId,
    layoutHash: specHash,
    pageIndex,
    pageCount,
  });
}

const SYNC_TICK_HEIGHT = 1.6;
const LABEL_FONT_SIZE = 8;
const LABEL_GAP = 6;
const NAME_FONT_SIZE = 11;
const COURSE_FONT_SIZE = 9;
const INSTRUCTION_FONT_SIZE = 7;
const SHORT_CODE_FONT_SIZE = 7;
const SHORT_CODE_STRIP_PT = 11;
const HEADER_QR_GAP = 8;
const BLANK_NAME_LINE = '________________________________';
const RUT_MODE_NAME_LINE = 'Nombre: ____________________________';
const RUT_INSTRUCTION_LINES = [
  'RUT: rellena UN círculo por columna, de izquierda a derecha.',
  'La última columna es el dígito verificador (marca K si corresponde).',
  'Si tu RUT tiene 7 dígitos, marca 0 en la primera columna.',
] as const;

export function computeDrawPlan(
  spec: LayoutSpec,
  pageIndex: number,
  options: { reserveShortCodeStrip?: boolean } = {},
): SheetDrawPlan {
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
    {
      x: fiducialMargin,
      y: pageHeight - fiducialMargin - fiducialSide,
      width: fiducialSide,
      height: fiducialSide,
    },
    {
      x: pageWidth - fiducialMargin - fiducialSide,
      y: pageHeight - fiducialMargin - fiducialSide,
      width: fiducialSide,
      height: fiducialSide,
    },
    { x: fiducialMargin, y: fiducialMargin, width: fiducialSide, height: fiducialSide },
    {
      x: pageWidth - fiducialMargin - fiducialSide,
      y: fiducialMargin,
      width: fiducialSide,
      height: fiducialSide,
    },
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
        group: bubble.group ?? null,
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

  const cropRegions: DrawPlanCropRegion[] = [];
  for (const field of spec.fields) {
    if (field.pageIndex !== pageIndex || field.kind !== 'crop_region' || field.region === null) {
      continue;
    }
    const left = toX(field.region.topLeft.x);
    const topPdf = toY(field.region.topLeft.y);
    const right = toX(field.region.bottomRight.x);
    const bottomPdf = toY(field.region.bottomRight.y);
    cropRegions.push({
      printedNumber: field.printedNumber,
      rect: { x: left, y: bottomPdf, width: right - left, height: topPdf - bottomPdf },
    });
  }

  const syncTicks: DrawPlanRect[] = Array.from(rowCenters)
    .sort((a, b) => b - a)
    .map((cy) => ({
      x: fiducialMargin,
      y: cy - SYNC_TICK_HEIGHT / 2,
      width: fiducialSide * 0.6,
      height: SYNC_TICK_HEIGHT,
    }));

  const identityMode = identityModeOf(spec);
  const region = identityMode === 'rut_bubbles' ? SHEET_QR_IDENTITY_REGION : spec.identity.region;
  const regionWidth = (region.bottomRight.x - region.topLeft.x) * frameWidth;
  const regionHeight = (region.bottomRight.y - region.topLeft.y) * frameHeight;
  const stripPt = options.reserveShortCodeStrip ? SHORT_CODE_STRIP_PT : 0;
  const qrSize = Math.max(Math.min(regionWidth, regionHeight - stripPt), 1);
  const qrX = toX(region.topLeft.x) + (regionWidth - qrSize) / 2;
  const qrY = toY(region.bottomRight.y) + stripPt + (regionHeight - stripPt - qrSize) / 2;

  const rutGridBubbles: DrawPlanBubble[] =
    identityMode === 'rut_bubbles'
      ? (spec.identity.bubbles ?? []).map((bubble) => ({
          fieldId: 'identity_rut',
          printedNumber: 'RUT',
          value: bubble.value,
          group: bubble.group ?? null,
          cx: toX(bubble.center.x),
          cy: toY(bubble.center.y),
          radius: bubble.radius * frameWidth,
        }))
      : [];

  const instructions: DrawPlanLabel[] =
    identityMode === 'rut_bubbles'
      ? RUT_INSTRUCTION_LINES.map((text, index) => ({
          text,
          x: toX(0.55),
          y: toY(0.05 + index * 0.025),
        }))
      : [];

  const headerRightEdge = Math.min(qrX, pageWidth - fiducialMargin) - HEADER_QR_GAP;
  const header =
    identityMode === 'rut_bubbles'
      ? { nameX: toX(0.05), nameY: toY(0.015), courseX: toX(0.55), courseY: toY(0.02) }
      : { nameX: toX(0.02), nameY: toY(0.05), courseX: toX(0.02), courseY: toY(0.09) };
  const headerMaxWidth = {
    name: Math.max(headerRightEdge - header.nameX, 0),
    course: Math.max(headerRightEdge - header.courseX, 0),
  };

  return {
    pageWidth,
    pageHeight,
    frame: { x: frameLeft, y: frameTop, width: frameWidth, height: frameHeight },
    fiducials,
    bubbles,
    labels,
    syncTicks,
    qr: { x: qrX, y: qrY, size: qrSize },
    header,
    headerMaxWidth,
    rutGridBubbles,
    instructions,
    cropRegions,
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

  const reserveShortCodeStrip = sheets.some((sheet) => sheet.shortCode !== null);
  const plans: SheetDrawPlan[] = [];
  for (let pageIndex = 0; pageIndex < spec.pageCount; pageIndex++) {
    plans.push(computeDrawPlan(spec, pageIndex, { reserveShortCodeStrip }));
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

      for (const bubble of plan.rutGridBubbles) {
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

      for (const crop of plan.cropRegions) {
        page.drawRectangle({
          ...crop.rect,
          borderColor: black,
          borderWidth: 0.8,
        });
        page.drawText(crop.printedNumber, {
          x: crop.rect.x + 3,
          y: crop.rect.y + crop.rect.height - LABEL_FONT_SIZE - 3,
          size: LABEL_FONT_SIZE,
          font: boldFont,
          color: black,
        });
      }

      for (const instruction of plan.instructions) {
        page.drawText(instruction.text, {
          x: instruction.x,
          y: instruction.y,
          size: INSTRUCTION_FONT_SIZE,
          font,
          color: black,
        });
      }

      const payload = qrPayloadForSheet(sheet, specHash, pageIndex, spec.pageCount);
      const qrPng = await QRCode.toBuffer(payload, {
        errorCorrectionLevel: sheet.shortCode !== null ? 'Q' : 'M',
        margin: 0,
      });
      const qrImage = await doc.embedPng(qrPng);
      page.drawImage(qrImage, {
        x: plan.qr.x,
        y: plan.qr.y,
        width: plan.qr.size,
        height: plan.qr.size,
      });

      if (sheet.shortCode !== null) {
        const codeText = formatShortCode(sheet.shortCode);
        const codeWidth = font.widthOfTextAtSize(codeText, SHORT_CODE_FONT_SIZE);
        page.drawText(codeText, {
          x: plan.qr.x + (plan.qr.size - codeWidth) / 2,
          y: plan.qr.y - SHORT_CODE_FONT_SIZE - 2,
          size: SHORT_CODE_FONT_SIZE,
          font,
          color: black,
        });
      }

      const rutMode = identityModeOf(spec) === 'rut_bubbles';
      const identityLine = rutMode
        ? RUT_MODE_NAME_LINE
        : buildSheetIdentityLine(sheet) || BLANK_NAME_LINE;
      page.drawText(
        fitTextToWidth(identityLine, plan.headerMaxWidth.name, (value) =>
          boldFont.widthOfTextAtSize(value, NAME_FONT_SIZE),
        ),
        {
          x: plan.header.nameX,
          y: plan.header.nameY,
          size: NAME_FONT_SIZE,
          font: boldFont,
          color: black,
        },
      );

      const contextLine = buildSheetContextLine(sheet, { includeClassGroup: rutMode });
      if (contextLine.length > 0) {
        page.drawText(
          fitTextToWidth(contextLine, plan.headerMaxWidth.course, (value) =>
            font.widthOfTextAtSize(value, COURSE_FONT_SIZE),
          ),
          {
            x: plan.header.courseX,
            y: plan.header.courseY,
            size: COURSE_FONT_SIZE,
            font,
            color: black,
          },
        );
      }
    }
  }

  return doc.save();
}
