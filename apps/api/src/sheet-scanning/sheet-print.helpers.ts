import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import * as QRCode from 'qrcode';
import {
  buildOmrQrPayload,
  buildOmrShortQrPayload,
  formatSheetDayMonthYear,
  formatShortCode,
  type LayoutField,
  type LayoutSpec,
  type OmrFieldResponse,
  type OmrRegion,
} from '@soe/types';
import {
  hasMultiBoxOperators,
  identityModeOf,
  isTeacherScoreField,
  MULTI_BOX_LABEL_GAP_MM,
  MULTI_BOX_OPERATOR_SPACE_MM,
  PAPER_SIZES_PT,
  RESPONSE_FIELD_PADDING_MM,
  SHEET_QR_IDENTITY_REGION,
  TEACHER_SCORE_CAPTION,
} from './sheet-layout.helpers';

export { PAPER_SIZES_PT };

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

export interface DrawPlanResponseBox {
  partId: string;
  role: OmrFieldResponse['boxes'][number]['role'];
  rect: DrawPlanRect;
}

export interface DrawPlanSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DrawPlanGlyph {
  text: string;
  centerX: number;
  centerY: number;
  size: number;
  align: 'center' | 'left' | 'right';
  maxWidth?: number;
}

export interface PlacedGlyph {
  text: string;
  x: number;
  y: number;
  size: number;
}

export interface DrawPlanResponseField {
  printedNumber: string;
  rect: DrawPlanRect;
  label: DrawPlanLabel;
  boxes: DrawPlanResponseBox[];
  segments: DrawPlanSegment[];
  glyphs: DrawPlanGlyph[];
}

export interface DrawPlanOptions {
  reserveShortCodeStrip?: boolean;
  unitsByItemId?: ReadonlyMap<string, string>;
}

export interface SheetDrawPlan {
  pageWidth: number;
  pageHeight: number;
  frame: DrawPlanRect;
  fiducials: DrawPlanRect[];
  bubbles: DrawPlanBubble[];
  labels: DrawPlanLabel[];
  captions: DrawPlanLabel[];
  syncTicks: DrawPlanRect[];
  qr: { x: number; y: number; size: number };
  header: { nameX: number; nameY: number; courseX: number; courseY: number };
  headerMaxWidth: { name: number; course: number };
  rutGridBubbles: DrawPlanBubble[];
  instructions: DrawPlanLabel[];
  cropRegions: DrawPlanCropRegion[];
  responseFields: DrawPlanResponseField[];
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
  gradeCode: string | null;
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

const GRADE_CYCLE_WORDS: Record<string, string> = { basic: 'basico', medio: 'medio' };
const ROMAN_BY_LEVEL = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'] as const;

export function gradeAliasesFromCode(code: string | null): string[] {
  if (code === null) return [];
  const match = /^(\d{1,2})[a-z]{2}_(basic|medio)$/i.exec(code.trim());
  if (match === null) return [];
  const level = Number(match[1]);
  const cycle = GRADE_CYCLE_WORDS[match[2]!.toLowerCase()];
  if (cycle === undefined || level < 1) return [];
  const aliases = [`${level} ${cycle}`];
  const roman = ROMAN_BY_LEVEL[level - 1];
  if (roman !== undefined) aliases.push(`${roman} ${cycle}`);
  return aliases;
}

function mentionsGrade(label: string, gradeCode: string | null): boolean {
  const normalized = normalizeForComparison(label);
  return gradeAliasesFromCode(gradeCode).some((alias) => normalized.includes(alias));
}

export function buildClassGroupLabel(
  gradeName: string | null,
  className: string | null,
): string | null {
  const grade = gradeName?.trim() ?? '';
  const group = className?.trim() ?? '';
  if (group.length === 0) return grade.length === 0 ? null : grade;
  if (grade.length === 0) return group;
  if (normalizeForComparison(group).includes(normalizeForComparison(grade))) return group;
  return `${grade} ${group}`;
}

export function buildInstrumentLabel(parts: InstrumentLabelParts): string {
  const period = parts.applicationPeriod
    ? (APPLICATION_PERIOD_LABELS[parts.applicationPeriod] ?? parts.applicationPeriod)
    : null;

  let label = parts.name.trim();
  label = appendIfMissing(label, parts.subjectName);
  if (!mentionsGrade(label, parts.gradeCode)) {
    label = appendIfMissing(label, parts.gradeName);
  }
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
const UNIT_GAP_PT = 5;
const RESPONSE_LABEL_TOP_OFFSET = 17;
const UNIT_FONT_SIZE = 11;
const COMPONENT_GLYPH_SCALE = 1.25;
const SEPARATOR_GLYPH_SCALE = 0.9;
const MULTI_BOX_LABEL_FONT_SIZE = 8;
const MULTI_BOX_OPERATOR_FONT_SIZE = 14;
const MIN_GLYPH_FONT_SIZE = 5;
const PT_PER_MM = 72 / 25.4;
const RUT_INSTRUCTION_LINES = [
  'RUT: rellena UN círculo por columna, de izquierda a derecha.',
  'La última columna es el dígito verificador (marca K si corresponde).',
  'Si tu RUT tiene 7 dígitos, marca 0 en la primera columna.',
] as const;

interface FrameMapper {
  toX: (nx: number) => number;
  toY: (ny: number) => number;
}

function rectOf(region: OmrRegion, frame: FrameMapper): DrawPlanRect {
  const left = frame.toX(region.topLeft.x);
  const top = frame.toY(region.topLeft.y);
  const right = frame.toX(region.bottomRight.x);
  const bottom = frame.toY(region.bottomRight.y);
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

function componentIndexOf(partId: string): number | null {
  const match = /^components\.(\d+)(\.|$)/.exec(partId);
  return match ? Number(match[1]) : null;
}

function spanOf(boxes: readonly DrawPlanResponseBox[]): DrawPlanRect {
  let left = Number.POSITIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    left = Math.min(left, box.rect.x);
    bottom = Math.min(bottom, box.rect.y);
    right = Math.max(right, box.rect.x + box.rect.width);
    top = Math.max(top, box.rect.y + box.rect.height);
  }
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

function fractionBars(boxes: readonly DrawPlanResponseBox[]): DrawPlanSegment[] {
  const denominators = new Map<string, DrawPlanResponseBox>();
  for (const box of boxes) {
    if (box.role === 'denominator') {
      denominators.set(box.partId.slice(0, -'denominator'.length), box);
    }
  }
  const segments: DrawPlanSegment[] = [];
  for (const numerator of boxes) {
    if (numerator.role !== 'numerator') continue;
    const denominator = denominators.get(numerator.partId.slice(0, -'numerator'.length));
    if (!denominator) continue;
    const y = (numerator.rect.y + denominator.rect.y + denominator.rect.height) / 2;
    segments.push({
      x1: numerator.rect.x,
      y1: y,
      x2: numerator.rect.x + numerator.rect.width,
      y2: y,
    });
  }
  return segments;
}

function tupleGlyphs(boxes: readonly DrawPlanResponseBox[]): DrawPlanGlyph[] {
  const byComponent = new Map<number, DrawPlanResponseBox[]>();
  for (const box of boxes) {
    const component = componentIndexOf(box.partId);
    if (component === null) continue;
    (byComponent.get(component) ?? byComponent.set(component, []).get(component)!).push(box);
  }
  const spans = Array.from(byComponent.entries())
    .sort(([a], [b]) => a - b)
    .map(([, componentBoxes]) => spanOf(componentBoxes));
  if (spans.length === 0) return [];
  const block = spanOf(boxes);
  const centerY = block.y + block.height / 2;
  const size = Math.min(block.height, spans[0]!.height * 2) * COMPONENT_GLYPH_SCALE;
  const first = spans[0]!;
  const last = spans[spans.length - 1]!;
  const glyphs: DrawPlanGlyph[] = [
    { text: '(', centerX: first.x - size * 0.25, centerY, size, align: 'right' },
    { text: ')', centerX: last.x + last.width + size * 0.25, centerY, size, align: 'left' },
  ];
  for (let index = 1; index < spans.length; index++) {
    const previous = spans[index - 1]!;
    const current = spans[index]!;
    glyphs.push({
      text: ';',
      centerX: (previous.x + previous.width + current.x) / 2,
      centerY,
      size: size * SEPARATOR_GLYPH_SCALE,
      align: 'center',
    });
  }
  return glyphs;
}

function partBoxesOf(boxes: readonly DrawPlanResponseBox[], partId: string): DrawPlanResponseBox[] {
  return boxes.filter((box) => box.partId === partId || box.partId.startsWith(`${partId}.`));
}

function sameRow(a: DrawPlanRect, b: DrawPlanRect): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height;
}

function multiBoxGlyphs(
  response: OmrFieldResponse,
  boxes: readonly DrawPlanResponseBox[],
  regionLeft: number,
): DrawPlanGlyph[] {
  const format = response.format;
  if (format.kind !== 'multi_box') return [];
  const inline = hasMultiBoxOperators(format);
  const glyphs: DrawPlanGlyph[] = [];
  let previous: DrawPlanRect | null = null;
  for (const part of format.boxes) {
    const partBoxes = partBoxesOf(boxes, part.partId);
    if (partBoxes.length === 0) continue;
    const span = spanOf(partBoxes);
    const centerY = span.y + span.height / 2;
    const labelRight = span.x - MULTI_BOX_LABEL_GAP_MM * PT_PER_MM;
    if (!inline) {
      const labelLeft = regionLeft + LABEL_GAP;
      glyphs.push({
        text: part.label,
        centerX: labelLeft,
        centerY,
        size: MULTI_BOX_LABEL_FONT_SIZE,
        align: 'left',
        maxWidth: Math.max(labelRight - labelLeft, 0),
      });
      continue;
    }
    let leadLeft =
      previous !== null && sameRow(previous, span)
        ? previous.x + previous.width
        : regionLeft + RESPONSE_FIELD_PADDING_MM * PT_PER_MM;
    if (part.operatorBefore !== undefined) {
      const operatorSpace = MULTI_BOX_OPERATOR_SPACE_MM * PT_PER_MM;
      glyphs.push({
        text: part.operatorBefore,
        centerX: leadLeft + operatorSpace / 2,
        centerY,
        size: MULTI_BOX_OPERATOR_FONT_SIZE,
        align: 'center',
        maxWidth: operatorSpace,
      });
      leadLeft += operatorSpace;
    }
    glyphs.push({
      text: part.label,
      centerX: labelRight,
      centerY,
      size: MULTI_BOX_LABEL_FONT_SIZE,
      align: 'right',
      maxWidth: Math.max(labelRight - leadLeft, 0),
    });
    previous = span;
  }
  return glyphs;
}

export function placeGlyph(
  glyph: DrawPlanGlyph,
  widthOf: (text: string, size: number) => number,
): PlacedGlyph | null {
  let size = glyph.size;
  let text = glyph.text;
  if (glyph.maxWidth !== undefined) {
    const natural = widthOf(text, size);
    if (natural > glyph.maxWidth) {
      size = Math.max((size * glyph.maxWidth) / natural, MIN_GLYPH_FONT_SIZE);
      text = fitTextToWidth(text, glyph.maxWidth, (value) => widthOf(value, size));
      if (widthOf(text, size) > glyph.maxWidth) return null;
    }
  }
  const width = widthOf(text, size);
  const x =
    glyph.align === 'center'
      ? glyph.centerX - width / 2
      : glyph.align === 'right'
        ? glyph.centerX - width
        : glyph.centerX;
  return { text, x, y: glyph.centerY - size * 0.35, size };
}

function buildResponseField(
  field: LayoutField & { region: OmrRegion; response: OmrFieldResponse },
  frame: FrameMapper,
  unit: string | null,
): DrawPlanResponseField {
  const rect = rectOf(field.region, frame);
  const boxes = field.response.boxes.map((box) => ({
    partId: box.partId,
    role: box.role,
    rect: rectOf(box.region, frame),
  }));
  const segments = fractionBars(boxes);
  const glyphs: DrawPlanGlyph[] = [];
  for (const box of boxes) {
    if (box.role === 'line') {
      segments.push({
        x1: box.rect.x,
        y1: box.rect.y,
        x2: box.rect.x + box.rect.width,
        y2: box.rect.y,
      });
    }
    if (box.role === 'decimal_separator') {
      glyphs.push({
        text: ',',
        centerX: box.rect.x + box.rect.width / 2,
        centerY: box.rect.y + box.rect.height * 0.3,
        size: box.rect.height * COMPONENT_GLYPH_SCALE,
        align: 'center',
      });
    }
  }
  if (field.response.format.kind === 'ordered_tuple') glyphs.push(...tupleGlyphs(boxes));
  glyphs.push(...multiBoxGlyphs(field.response, boxes, rect.x));
  if (unit !== null && boxes.length > 0) {
    const span = spanOf(boxes);
    glyphs.push({
      text: unit,
      centerX: span.x + span.width + UNIT_GAP_PT,
      centerY: span.y + span.height / 2,
      size: UNIT_FONT_SIZE,
      align: 'left',
    });
  }
  return {
    printedNumber: field.printedNumber,
    rect,
    label: {
      text: field.printedNumber,
      x: rect.x - LABEL_GAP - LABEL_FONT_SIZE * 0.6 * field.printedNumber.length,
      y: rect.y + rect.height - RESPONSE_LABEL_TOP_OFFSET,
    },
    boxes,
    segments,
    glyphs,
  };
}

export function computeDrawPlan(
  spec: LayoutSpec,
  pageIndex: number,
  options: DrawPlanOptions = {},
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
  const captions: DrawPlanLabel[] = [];
  const rowCenters = new Set<number>();

  for (const field of spec.fields) {
    if (field.pageIndex !== pageIndex) continue;
    let minCx = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
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
      maxRight = Math.max(maxRight, cx + radius);
    }
    if (field.bubbles.length > 0 && isTeacherScoreField(field)) {
      captions.push({
        text: TEACHER_SCORE_CAPTION,
        x: maxRight + 2 * LABEL_GAP,
        y: rowCy - LABEL_FONT_SIZE * 0.35,
      });
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
  const responseFields: DrawPlanResponseField[] = [];
  for (const field of spec.fields) {
    if (field.pageIndex !== pageIndex || field.kind !== 'crop_region' || field.region === null) {
      continue;
    }
    if (field.response) {
      const unit = options.unitsByItemId?.get(field.response.itemId) ?? null;
      responseFields.push(
        buildResponseField(
          { ...field, region: field.region, response: field.response },
          { toX, toY },
          unit,
        ),
      );
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
    captions,
    syncTicks,
    qr: { x: qrX, y: qrY, size: qrSize },
    header,
    headerMaxWidth,
    rutGridBubbles,
    instructions,
    cropRegions,
    responseFields,
  };
}

function drawResponseField(
  page: PDFPage,
  response: DrawPlanResponseField,
  font: PDFFont,
  boldFont: PDFFont,
): void {
  const black = rgb(0, 0, 0);
  page.drawText(response.label.text, {
    x: response.label.x,
    y: response.label.y,
    size: LABEL_FONT_SIZE,
    font: boldFont,
    color: black,
  });
  for (const box of response.boxes) {
    if (box.role === 'line' || box.role === 'decimal_separator') continue;
    page.drawRectangle({ ...box.rect, borderColor: black, borderWidth: 0.8 });
  }
  for (const segment of response.segments) {
    page.drawLine({
      start: { x: segment.x1, y: segment.y1 },
      end: { x: segment.x2, y: segment.y2 },
      thickness: 0.8,
      color: black,
    });
  }
  for (const glyph of response.glyphs) {
    const placed = placeGlyph(glyph, (text, size) => font.widthOfTextAtSize(text, size));
    if (placed === null) continue;
    page.drawText(placed.text, {
      x: placed.x,
      y: placed.y,
      size: placed.size,
      font,
      color: black,
    });
  }
}

export async function renderSheetsPdf(
  spec: LayoutSpec,
  specHash: string,
  sheets: readonly PrintableSheetInfo[],
  options: Pick<DrawPlanOptions, 'unitsByItemId'> = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const reserveShortCodeStrip = sheets.some((sheet) => sheet.shortCode !== null);
  const plans: SheetDrawPlan[] = [];
  for (let pageIndex = 0; pageIndex < spec.pageCount; pageIndex++) {
    plans.push(
      computeDrawPlan(spec, pageIndex, {
        reserveShortCodeStrip,
        unitsByItemId: options.unitsByItemId,
      }),
    );
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

      for (const caption of plan.captions) {
        page.drawText(caption.text, {
          x: caption.x,
          y: caption.y,
          size: LABEL_FONT_SIZE,
          font,
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

      for (const response of plan.responseFields) {
        drawResponseField(page, response, font, boldFont);
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
