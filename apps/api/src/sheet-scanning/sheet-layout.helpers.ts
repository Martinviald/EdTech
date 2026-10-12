import {
  layoutHash,
  resolveResponseFormat,
  sameRubricCode,
  type ItemContent,
  type ItemType,
  type LayoutDraftModel,
  type LayoutExcludedItemModel,
  type LayoutField,
  type LayoutSpec,
  type OmrBubble,
  type OmrRegion,
  type OmrResponseBox,
  type ResponseFormat,
  SHEET_FIDUCIAL_MARGIN_RATIO,
  SHEET_FIDUCIAL_SIZE_RATIO,
  SHEET_QR_IDENTITY_REGION,
  type SheetIdentityMode,
} from '@soe/types';
import { numericBoxesFor, responseGeometryOf } from '@soe/answer-reading';
import {
  buildPrintedLabelIndex,
  planBubbleChoice,
  resolveScanLabel,
  type ResolvableItem,
} from '../answer-sheets/lib/composite-answers';

export interface DerivableItem {
  id: string;
  position: number;
  printedNumber: string | null;
  type: ItemType;
  content: ItemContent;
}

export interface BubbleRow {
  label: string;
  values: string[];
  teacherScore: boolean;
}

export interface CorrectableItem {
  item: DerivableItem;
  label: string;
  values: string[];
  responseFormat: VisionResponseFormat | null;
  bubbleRows: BubbleRow[];
}

export type VisionResponseFormat = Exclude<
  ResponseFormat,
  { kind: 'bubble_choice' } | { kind: 'score_bubbles' }
>;

export interface PartitionedItems {
  correctable: CorrectableItem[];
  excluded: LayoutExcludedItemModel[];
}

export interface InvariantViolation {
  invariant: number;
  message: string;
}

// Fuente única en `@soe/types`: el visor de captura dibuja sus guías con estos mismos
// valores, así que no pueden vivir sólo acá.
export { SHEET_FIDUCIAL_SIZE_RATIO, SHEET_FIDUCIAL_MARGIN_RATIO };
export const SHEET_BUBBLE_RADIUS = 0.011;
export const SHEET_MAX_ROWS_PER_COLUMN = 25;
export const SHEET_COLUMNS_PER_PAGE = 3;
export const SHEET_MAX_BUBBLES_PER_FIELD = 6;
export const SHEET_FIELDS_PER_PAGE = SHEET_MAX_ROWS_PER_COLUMN * SHEET_COLUMNS_PER_PAGE;
export const TEACHER_SCORE_FIELD_SUFFIX = '_puntaje';
export const TEACHER_SCORE_CAPTION = 'Puntaje (lo marca el docente)';
const TEACHER_SCORE_MAX_CODE_LENGTH = 3;
const TEACHER_SCORE_ROW_HEIGHT_MM = 10;

const GRID_TOP = 0.18;
const GRID_TOP_RUT_BUBBLES = 0.34;
const GRID_BOTTOM = 0.97;
const COLUMN_START_X = [0.05, 0.37, 0.69] as const;
const FIRST_BUBBLE_OFFSET_X = 0.045;
const BUBBLE_SPACING_X = 0.05;

export { SHEET_QR_IDENTITY_REGION };

export const RUT_BODY_GROUP_COUNT = 8;
export const RUT_DV_GROUP_INDEX = RUT_BODY_GROUP_COUNT;
export const RUT_GRID_REGION: OmrRegion = {
  topLeft: { x: 0.05, y: 0.03 },
  bottomRight: { x: 0.52, y: 0.3 },
};
const RUT_GRID_BUBBLE_RADIUS = 0.008;
const RUT_COLUMN_START_X = 0.075;
const RUT_COLUMN_SPACING_X = 0.05;
const RUT_ROW_START_Y = 0.06;
const RUT_ROW_SPACING_Y = 0.022;
const RUT_DIGIT_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const RUT_DV_EXTRA_VALUE = 'K';

const TRUE_FALSE_VALUES = ['V', 'F'] as const;
const SUPPORTED_ITEM_TYPES: ReadonlySet<ItemType> = new Set(['multiple_choice', 'true_false']);

export const PAPER_SIZES_PT: Record<LayoutSpec['paper'], { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
  legal: { width: 612, height: 1008 },
};
const MM_PER_PT = 25.4 / 72;

export const RESPONSE_CHAR_BOX_MM = 9;
export const RESPONSE_MIN_BOX_MM = 8;
const RESPONSE_BOX_GAP_MM = 2;
const SIGN_BOX_GAP_MM = 5;
const DECIMAL_SEPARATOR_WIDTH_MM = 5;
const FRACTION_PART_WIDTH_MM = 24;
const FRACTION_BAR_GAP_MM = 5;
const FRACTION_WHOLE_WIDTH_MM = 14;
const TUPLE_COMPONENT_WIDTH_MM = 24;
const TUPLE_PARENTHESIS_SPACE_MM = 5;
const TUPLE_SEPARATOR_SPACE_MM = 7;
const SEQUENCE_GAP_MM = 4;
const WORD_BOX_WIDTH_MM = 40;
const TEXT_LINE_HEIGHT_MM = 10;
const SHORT_TEXT_WORDS_PER_LINE = 8;
const SHORT_TEXT_MAX_LINES = 3;
const MULTI_BOX_LABEL_WIDTH_MM = 30;
const MULTI_BOX_TEXT_WIDTH_MM = 80;
const MULTI_BOX_NUMBER_WIDTH_MM = 40;
export const MULTI_BOX_OPERATOR_SPACE_MM = 8;
export const MULTI_BOX_LABEL_GAP_MM = 2;
const MULTI_BOX_LABEL_CHAR_MM = 1.7;
const MULTI_BOX_LABEL_MAX_MM = 40;
const MULTI_BOX_INLINE_NUMBER_WIDTH_MM = 24;
const MULTI_BOX_INLINE_GAP_MM = 3;
const MULTI_BOX_INLINE_ROW_GAP_MM = 4;
export const RESPONSE_FIELD_PADDING_MM = 3;
const RESPONSE_FIELD_GAP_MM = 4;
const RESPONSE_UNIT_SPACE_MM = 18;
const RESPONSE_FIELD_LEFT = 0.08;
const RESPONSE_FIELD_RIGHT = 0.95;
const COORDINATE_EPSILON = 1e-9;

export const RESPONSE_CROP_PROFILE_SHORT = 'short-answer@2';
export const RESPONSE_CROP_PROFILE_FREE_TEXT = 'free-text@2';

const VISION_FORMAT_KINDS: ReadonlySet<ResponseFormat['kind']> = new Set([
  'integer',
  'decimal',
  'fraction',
  'ordered_tuple',
  'sequence',
  'word_list',
  'short_text',
  'multi_box',
  'free_text',
  'math_work',
]);

export interface ResponseBoxMm {
  partId: string;
  role: OmrResponseBox['role'];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResponseBlockMm {
  boxes: ResponseBoxMm[];
  width: number;
  height: number;
}

export interface ResponseGeometryOptions {
  availableWidthMm: number;
  availableHeightMm: number;
  fractionDigits?: number;
}

export interface FrameSizeMm {
  width: number;
  height: number;
}

export function printedLabelOf(item: { position: number; printedNumber: string | null }): string {
  return item.printedNumber ?? String(item.position);
}

function fieldIdOf(label: string): string {
  const segments = label
    .split(/[^a-zA-Z0-9]+/)
    .filter((s) => s.length > 0)
    .map((segment, index) =>
      index === 0 && /^\d+$/.test(segment) ? segment.padStart(3, '0') : segment,
    );
  return `f_${segments.join('_')}`;
}

function bubbleValuesOf(item: DerivableItem): { values: string[] } | { reason: string } {
  if (item.type === 'true_false') return { values: [...TRUE_FALSE_VALUES] };

  const alternatives = (item.content as { alternatives?: { key?: unknown }[] }).alternatives;
  const keys = Array.isArray(alternatives)
    ? alternatives
        .map((alt) => (typeof alt.key === 'string' ? alt.key.trim() : ''))
        .filter((key) => key.length > 0)
    : [];

  if (keys.length < 2) {
    return { reason: 'El ítem no tiene alternativas suficientes para dibujar burbujas (mínimo 2)' };
  }
  if (keys.length > SHEET_MAX_BUBBLES_PER_FIELD) {
    return {
      reason: `El ítem tiene ${keys.length} alternativas y el máximo imprimible por fila es ${SHEET_MAX_BUBBLES_PER_FIELD}`,
    };
  }
  return { values: keys };
}

export function isVisionResponseFormat(
  format: ResponseFormat | null,
): format is VisionResponseFormat {
  return format !== null && VISION_FORMAT_KINDS.has(format.kind);
}

export function cropProfileIdFor(format: VisionResponseFormat): string {
  return format.kind === 'free_text' || format.kind === 'math_work'
    ? RESPONSE_CROP_PROFILE_FREE_TEXT
    : RESPONSE_CROP_PROFILE_SHORT;
}

export function sheetFrameSizeMm(
  paper: LayoutSpec['paper'],
  fiducials: Pick<LayoutSpec['fiducials'], 'sizeRatio' | 'marginRatio'>,
): FrameSizeMm {
  const { width, height } = PAPER_SIZES_PT[paper];
  const inset = 2 * (fiducials.marginRatio * width + (fiducials.sizeRatio * width) / 2);
  return { width: (width - inset) * MM_PER_PT, height: (height - inset) * MM_PER_PT };
}

function rowOfSquares(
  count: number,
  partIdOf: (index: number) => string,
  role: OmrResponseBox['role'],
  startX: number,
  y: number,
  gap: number,
): ResponseBoxMm[] {
  const boxes: ResponseBoxMm[] = [];
  for (let index = 0; index < count; index++) {
    boxes.push({
      partId: partIdOf(index),
      role,
      x: startX + index * (RESPONSE_CHAR_BOX_MM + gap),
      y,
      width: RESPONSE_CHAR_BOX_MM,
      height: RESPONSE_CHAR_BOX_MM,
    });
  }
  return boxes;
}

function blockOf(boxes: ResponseBoxMm[]): ResponseBlockMm {
  let width = 0;
  let height = 0;
  for (const box of boxes) {
    width = Math.max(width, box.x + box.width);
    height = Math.max(height, box.y + box.height);
  }
  return { boxes, width, height };
}

function signBox(): ResponseBoxMm {
  return {
    partId: 'sign',
    role: 'sign',
    x: 0,
    y: 0,
    width: RESPONSE_CHAR_BOX_MM,
    height: RESPONSE_CHAR_BOX_MM,
  };
}

function numberBlock(
  format: Extract<VisionResponseFormat, { kind: 'integer' | 'decimal' }>,
  options: ResponseGeometryOptions,
): ResponseBlockMm {
  const {
    signBox: hasSign,
    integerDigits,
    fractionDigits,
  } = numericBoxesFor(format, options.fractionDigits);
  const boxes: ResponseBoxMm[] = hasSign ? [signBox()] : [];
  let cursor = hasSign ? RESPONSE_CHAR_BOX_MM + SIGN_BOX_GAP_MM : 0;
  const digitCount = integerDigits + fractionDigits;

  for (let index = 0; index < digitCount; index++) {
    if (format.kind === 'decimal' && index === integerDigits) {
      boxes.push({
        partId: 'decimal_separator',
        role: 'decimal_separator',
        x: cursor,
        y: 0,
        width: DECIMAL_SEPARATOR_WIDTH_MM,
        height: RESPONSE_CHAR_BOX_MM,
      });
      cursor += DECIMAL_SEPARATOR_WIDTH_MM + RESPONSE_BOX_GAP_MM;
    }
    boxes.push({
      partId: `char.${index}`,
      role: 'char',
      x: cursor,
      y: 0,
      width: RESPONSE_CHAR_BOX_MM,
      height: RESPONSE_CHAR_BOX_MM,
    });
    cursor += RESPONSE_CHAR_BOX_MM + RESPONSE_BOX_GAP_MM;
  }
  return blockOf(boxes);
}

function fractionBoxes(prefix: string, x: number, y: number, width: number): ResponseBoxMm[] {
  return [
    {
      partId: `${prefix}numerator`,
      role: 'numerator',
      x,
      y,
      width,
      height: RESPONSE_CHAR_BOX_MM,
    },
    {
      partId: `${prefix}denominator`,
      role: 'denominator',
      x,
      y: y + RESPONSE_CHAR_BOX_MM + FRACTION_BAR_GAP_MM,
      width,
      height: RESPONSE_CHAR_BOX_MM,
    },
  ];
}

function fractionBlock(
  format: Extract<VisionResponseFormat, { kind: 'fraction' }>,
): ResponseBlockMm {
  const height = 2 * RESPONSE_CHAR_BOX_MM + FRACTION_BAR_GAP_MM;
  const middleY = (height - RESPONSE_CHAR_BOX_MM) / 2;
  const boxes: ResponseBoxMm[] = [];
  let cursor = 0;
  if (format.allowNegative) {
    boxes.push({ ...signBox(), y: middleY });
    cursor += RESPONSE_CHAR_BOX_MM + SIGN_BOX_GAP_MM;
  }
  if (format.allowMixed) {
    boxes.push({
      partId: 'whole',
      role: 'whole',
      x: cursor,
      y: middleY,
      width: FRACTION_WHOLE_WIDTH_MM,
      height: RESPONSE_CHAR_BOX_MM,
    });
    cursor += FRACTION_WHOLE_WIDTH_MM + RESPONSE_BOX_GAP_MM;
  }
  boxes.push(...fractionBoxes('', cursor, 0, FRACTION_PART_WIDTH_MM));
  return blockOf(boxes);
}

function tupleBlock(
  format: Extract<VisionResponseFormat, { kind: 'ordered_tuple' }>,
): ResponseBlockMm {
  const boxes: ResponseBoxMm[] = [];
  const isFraction = format.componentKind === 'fraction';
  const height = isFraction ? 2 * RESPONSE_CHAR_BOX_MM + FRACTION_BAR_GAP_MM : RESPONSE_CHAR_BOX_MM;
  const middleY = (height - RESPONSE_CHAR_BOX_MM) / 2;
  let cursor = TUPLE_PARENTHESIS_SPACE_MM;
  for (let index = 0; index < format.arity; index++) {
    if (isFraction) {
      boxes.push(...fractionBoxes(`components.${index}.`, cursor, 0, TUPLE_COMPONENT_WIDTH_MM));
    } else {
      boxes.push({
        partId: `components.${index}`,
        role: 'tuple_component',
        x: cursor,
        y: middleY,
        width: TUPLE_COMPONENT_WIDTH_MM,
        height: RESPONSE_CHAR_BOX_MM,
      });
    }
    cursor += TUPLE_COMPONENT_WIDTH_MM + TUPLE_SEPARATOR_SPACE_MM;
  }
  const width = cursor - TUPLE_SEPARATOR_SPACE_MM + TUPLE_PARENTHESIS_SPACE_MM;
  return { boxes, width, height };
}

function wordListBlock(
  format: Extract<VisionResponseFormat, { kind: 'word_list' }>,
  options: ResponseGeometryOptions,
): ResponseBlockMm {
  const perRow = Math.max(
    1,
    Math.floor(
      (options.availableWidthMm + RESPONSE_BOX_GAP_MM) / (WORD_BOX_WIDTH_MM + RESPONSE_BOX_GAP_MM),
    ),
  );
  const boxes: ResponseBoxMm[] = [];
  for (let index = 0; index < format.count; index++) {
    const row = Math.floor(index / perRow);
    const column = index % perRow;
    boxes.push({
      partId: `words.${index}`,
      role: 'word',
      x: column * (WORD_BOX_WIDTH_MM + RESPONSE_BOX_GAP_MM),
      y: row * (TEXT_LINE_HEIGHT_MM + RESPONSE_BOX_GAP_MM),
      width: WORD_BOX_WIDTH_MM,
      height: TEXT_LINE_HEIGHT_MM,
    });
  }
  return blockOf(boxes);
}

function lineBoxes(count: number, width: number): ResponseBoxMm[] {
  const boxes: ResponseBoxMm[] = [];
  for (let index = 0; index < count; index++) {
    boxes.push({
      partId: `lines.${index}`,
      role: 'line',
      x: 0,
      y: index * TEXT_LINE_HEIGHT_MM,
      width,
      height: TEXT_LINE_HEIGHT_MM,
    });
  }
  return boxes;
}

type MultiBoxFormat = Extract<VisionResponseFormat, { kind: 'multi_box' }>;
type MultiBoxPart = MultiBoxFormat['boxes'][number];

export function hasMultiBoxOperators(format: MultiBoxFormat): boolean {
  return format.boxes.some((part) => part.operatorBefore !== undefined);
}

function multiBoxBlock(format: MultiBoxFormat, options: ResponseGeometryOptions): ResponseBlockMm {
  if (hasMultiBoxOperators(format)) return inlineMultiBoxBlock(format, options);
  const boxes: ResponseBoxMm[] = [];
  let cursorY = 0;
  for (const part of format.boxes) {
    const x = MULTI_BOX_LABEL_WIDTH_MM;
    if (part.kind === 'fraction') {
      boxes.push(...fractionBoxes(`${part.partId}.`, x, cursorY, FRACTION_PART_WIDTH_MM));
      cursorY += 2 * RESPONSE_CHAR_BOX_MM + FRACTION_BAR_GAP_MM + RESPONSE_BOX_GAP_MM;
      continue;
    }
    boxes.push({
      partId: part.partId,
      role: 'line',
      x,
      y: cursorY,
      width: part.kind === 'short_text' ? MULTI_BOX_TEXT_WIDTH_MM : MULTI_BOX_NUMBER_WIDTH_MM,
      height: TEXT_LINE_HEIGHT_MM,
    });
    cursorY += TEXT_LINE_HEIGHT_MM + RESPONSE_BOX_GAP_MM;
  }
  return blockOf(boxes);
}

function multiBoxLabelSpaceMm(label: string): number {
  return Math.min(
    label.trim().length * MULTI_BOX_LABEL_CHAR_MM + MULTI_BOX_LABEL_GAP_MM,
    MULTI_BOX_LABEL_MAX_MM,
  );
}

function inlinePartSize(part: MultiBoxPart): { width: number; height: number } {
  if (part.kind === 'fraction') {
    return {
      width: FRACTION_PART_WIDTH_MM,
      height: 2 * RESPONSE_CHAR_BOX_MM + FRACTION_BAR_GAP_MM,
    };
  }
  return {
    width: part.kind === 'short_text' ? WORD_BOX_WIDTH_MM : MULTI_BOX_INLINE_NUMBER_WIDTH_MM,
    height: TEXT_LINE_HEIGHT_MM,
  };
}

function inlineMultiBoxBlock(
  format: MultiBoxFormat,
  options: ResponseGeometryOptions,
): ResponseBlockMm {
  type Placed = { part: MultiBoxPart; x: number; width: number; height: number };
  const rows: Placed[][] = [[]];
  let cursor = 0;
  for (const part of format.boxes) {
    const lead =
      (part.operatorBefore === undefined ? 0 : MULTI_BOX_OPERATOR_SPACE_MM) +
      multiBoxLabelSpaceMm(part.label);
    const size = inlinePartSize(part);
    const row = rows[rows.length - 1]!;
    if (row.length > 0 && cursor + lead + size.width > options.availableWidthMm) {
      rows.push([]);
      cursor = 0;
    }
    rows[rows.length - 1]!.push({ part, x: cursor + lead, ...size });
    cursor += lead + size.width + MULTI_BOX_INLINE_GAP_MM;
  }

  const boxes: ResponseBoxMm[] = [];
  let rowTop = 0;
  for (const row of rows) {
    const rowHeight = Math.max(...row.map((placed) => placed.height));
    for (const placed of row) {
      const y = rowTop + (rowHeight - placed.height) / 2;
      if (placed.part.kind === 'fraction') {
        boxes.push(...fractionBoxes(`${placed.part.partId}.`, placed.x, y, placed.width));
        continue;
      }
      boxes.push({
        partId: placed.part.partId,
        role: 'word',
        x: placed.x,
        y,
        width: placed.width,
        height: placed.height,
      });
    }
    rowTop += rowHeight + MULTI_BOX_INLINE_ROW_GAP_MM;
  }
  return blockOf(boxes);
}

export function responseBlockMm(
  format: VisionResponseFormat,
  options: ResponseGeometryOptions,
): ResponseBlockMm {
  switch (format.kind) {
    case 'integer':
    case 'decimal':
      return numberBlock(format, options);
    case 'fraction':
      return fractionBlock(format);
    case 'ordered_tuple':
      return tupleBlock(format);
    case 'sequence':
      return blockOf(
        rowOfSquares(
          format.length,
          (i) => `elements.${i}`,
          'sequence_element',
          0,
          0,
          SEQUENCE_GAP_MM,
        ),
      );
    case 'word_list':
      return wordListBlock(format, options);
    case 'short_text': {
      const lines = Math.min(
        Math.max(Math.ceil(format.maxWords / SHORT_TEXT_WORDS_PER_LINE), 1),
        SHORT_TEXT_MAX_LINES,
      );
      return blockOf(lineBoxes(lines, options.availableWidthMm));
    }
    case 'free_text': {
      const fitting = Math.max(Math.floor(options.availableHeightMm / TEXT_LINE_HEIGHT_MM), 1);
      return blockOf(lineBoxes(Math.min(format.lines, fitting), options.availableWidthMm));
    }
    case 'math_work': {
      const height = Math.max(format.heightRatio * options.availableHeightMm, RESPONSE_CHAR_BOX_MM);
      return blockOf([
        { partId: 'work', role: 'area', x: 0, y: 0, width: options.availableWidthMm, height },
      ]);
    }
    case 'multi_box':
      return multiBoxBlock(format, options);
  }
}

export function itemUnitOf(content: unknown): string | null {
  const unit = (content as { unit?: unknown } | null)?.unit;
  return typeof unit === 'string' && unit.trim().length > 0 ? unit.trim() : null;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function frameRegion(left: number, top: number, right: number, bottom: number): OmrRegion {
  return {
    topLeft: { x: roundCoordinate(left), y: roundCoordinate(top) },
    bottomRight: { x: roundCoordinate(right), y: roundCoordinate(bottom) },
  };
}

function responseCursorStart(
  bubbleCount: number,
  gridTop: number,
): { pageIndex: number; y: number } {
  if (bubbleCount === 0) return { pageIndex: 0, y: gridTop };
  const pageIndex = Math.floor((bubbleCount - 1) / SHEET_FIELDS_PER_PAGE);
  const fieldsInPage = bubbleCount - pageIndex * SHEET_FIELDS_PER_PAGE;
  const rowsUsed = Math.min(fieldsInPage, SHEET_MAX_ROWS_PER_COLUMN);
  const rowHeight = (GRID_BOTTOM - gridTop) / SHEET_MAX_ROWS_PER_COLUMN;
  return { pageIndex, y: gridTop + rowsUsed * rowHeight };
}

type FlowEntry =
  | { kind: 'response'; entry: CorrectableItem; format: VisionResponseFormat }
  | { kind: 'score'; row: BubbleRow };

function flowEntriesOf(correctable: readonly CorrectableItem[]): FlowEntry[] {
  const entries: FlowEntry[] = [];
  for (const entry of correctable) {
    if (entry.responseFormat !== null) {
      entries.push({ kind: 'response', entry, format: entry.responseFormat });
      continue;
    }
    for (const row of entry.bubbleRows) {
      if (row.teacherScore) entries.push({ kind: 'score', row });
    }
  }
  return entries;
}

export function isTeacherScoreField(field: Pick<LayoutField, 'fieldId' | 'kind'>): boolean {
  return field.kind === 'bubble_group' && field.fieldId.endsWith(TEACHER_SCORE_FIELD_SUFFIX);
}

function teacherScoreField(
  row: BubbleRow,
  pageIndex: number,
  top: number,
  height: number,
  padX: number,
): LayoutField {
  const centerY = roundCoordinate(top + height / 2);
  return {
    fieldId: `${fieldIdOf(row.label)}${TEACHER_SCORE_FIELD_SUFFIX}`,
    kind: 'bubble_group',
    printedNumber: row.label,
    pageIndex,
    selectMode: 'single',
    bubbles: row.values.map((value, index) => ({
      value,
      center: {
        x: roundCoordinate(
          RESPONSE_FIELD_LEFT + padX + SHEET_BUBBLE_RADIUS + index * BUBBLE_SPACING_X,
        ),
        y: centerY,
      },
      radius: SHEET_BUBBLE_RADIUS,
    })),
    region: null,
  };
}

function responseField(
  entry: CorrectableItem,
  format: VisionResponseFormat,
  block: ResponseBlockMm,
  geometry: {
    pageIndex: number;
    top: number;
    height: number;
    width: number;
    padX: number;
    padY: number;
  },
  frame: FrameSizeMm,
): LayoutField {
  const { pageIndex, top, height, width, padX, padY } = geometry;
  const left = RESPONSE_FIELD_LEFT;
  const boxes: OmrResponseBox[] = block.boxes.map((box) => {
    const boxLeft = left + padX + box.x / frame.width;
    const boxTop = top + padY + box.y / frame.height;
    return {
      partId: box.partId,
      role: box.role,
      region: frameRegion(
        boxLeft,
        boxTop,
        boxLeft + box.width / frame.width,
        boxTop + box.height / frame.height,
      ),
    };
  });
  return {
    fieldId: fieldIdOf(entry.label),
    kind: 'crop_region',
    printedNumber: entry.label,
    pageIndex,
    selectMode: 'single',
    bubbles: [],
    region: frameRegion(left, top, left + width, top + height),
    response: {
      itemId: entry.item.id,
      format,
      boxes,
      cropProfileId: cropProfileIdFor(format),
    },
  };
}

function placeFlowFields(
  entries: readonly FlowEntry[],
  bubbleCount: number,
  gridTop: number,
  frame: FrameSizeMm,
): LayoutField[] {
  const fields: LayoutField[] = [];
  const gap = RESPONSE_FIELD_GAP_MM / frame.height;
  const padX = RESPONSE_FIELD_PADDING_MM / frame.width;
  const padY = RESPONSE_FIELD_PADDING_MM / frame.height;
  const contentWidthMm = (RESPONSE_FIELD_RIGHT - RESPONSE_FIELD_LEFT) * frame.width;
  const availableHeightMm = (GRID_BOTTOM - gridTop) * frame.height - 2 * RESPONSE_FIELD_PADDING_MM;
  let { pageIndex, y } = responseCursorStart(bubbleCount, gridTop);
  if (bubbleCount > 0) y += gap;

  for (const flow of entries) {
    if (flow.kind === 'score') {
      const height = TEACHER_SCORE_ROW_HEIGHT_MM / frame.height;
      if (y + height > GRID_BOTTOM) {
        pageIndex += 1;
        y = gridTop;
      }
      fields.push(teacherScoreField(flow.row, pageIndex, y, height, padX));
      y += height + gap;
      continue;
    }
    const { entry, format } = flow;
    const unitSpaceMm = itemUnitOf(entry.item.content) === null ? 0 : RESPONSE_UNIT_SPACE_MM;
    const block = responseBlockMm(format, {
      availableWidthMm: contentWidthMm - 2 * RESPONSE_FIELD_PADDING_MM - unitSpaceMm,
      availableHeightMm,
      fractionDigits: responseGeometryOf(entry.item.content).fractionDigits ?? undefined,
    });
    const height = (block.height + 2 * RESPONSE_FIELD_PADDING_MM) / frame.height;
    const width = (block.width + 2 * RESPONSE_FIELD_PADDING_MM + unitSpaceMm) / frame.width;
    if (y + height > GRID_BOTTOM) {
      pageIndex += 1;
      y = gridTop;
    }
    fields.push(
      responseField(entry, format, block, { pageIndex, top: y, height, width, padX, padY }, frame),
    );
    y += height + gap;
  }
  return fields;
}

function unsupportedReason(item: DerivableItem, format: ResponseFormat | null): string {
  if (format === null) {
    return `Tipo de ítem "${item.type}" no soportado por el lector: no tiene un formato de respuesta que se pueda imprimir en la hoja`;
  }
  return `Tipo de ítem "${item.type}" no soportado por el lector todavía: su formato de respuesta (${format.kind}) aún no se imprime en la hoja`;
}

type RowsOrReason = { rows: BubbleRow[] } | { reason: string };

function choiceRowsOf(
  item: DerivableItem,
  label: string,
  labelIndex: Map<string, ResolvableItem>,
): RowsOrReason {
  const plan = planBubbleChoice(item, SHEET_MAX_BUBBLES_PER_FIELD);
  if ('reason' in plan) return plan;
  const rows: BubbleRow[] = [];
  for (const row of plan.rows) {
    const rowLabel = `${label}.${row.subKey}`;
    const resolved = resolveScanLabel(labelIndex, rowLabel, null);
    if (resolved.kind !== 'sub' || resolved.item !== item || resolved.subKey !== row.subKey) {
      return {
        reason: `La fila "${rowLabel}" de las burbujas choca con otro número impreso del instrumento`,
      };
    }
    rows.push({ label: rowLabel, values: row.values, teacherScore: false });
  }
  return { rows };
}

function teacherScoreRowsOf(
  item: DerivableItem,
  label: string,
  format: Extract<ResponseFormat, { kind: 'score_bubbles' }>,
): RowsOrReason {
  if (item.type !== 'rubric_scored') {
    return {
      reason: `Las burbujas de puntaje docente (score_bubbles) solo aplican a ítems de rúbrica, no a "${item.type}"`,
    };
  }
  if (format.levels.length > SHEET_MAX_BUBBLES_PER_FIELD) {
    return {
      reason: `El ítem declara ${format.levels.length} niveles y el máximo imprimible por fila es ${SHEET_MAX_BUBBLES_PER_FIELD}`,
    };
  }
  const levels = (item.content as { levels?: { code?: unknown }[] }).levels ?? [];
  const codes = levels
    .map((level) => level.code)
    .filter((code): code is string => typeof code === 'string');
  const values = format.levels.map((level) => level.trim());
  const unknown = values.filter((value) => !codes.some((code) => sameRubricCode(code, value)));
  if (unknown.length > 0) {
    return {
      reason: `Los niveles ${unknown.join(', ')} de las burbujas de puntaje no existen en la rúbrica del ítem`,
    };
  }
  if (values.some((value) => value.length > TEACHER_SCORE_MAX_CODE_LENGTH)) {
    return { reason: 'Los códigos de nivel de la rúbrica son muy largos para una burbuja' };
  }
  if (new Set(values).size !== values.length) {
    return { reason: 'Las burbujas de puntaje repiten un nivel' };
  }
  return { rows: [{ label, values, teacherScore: true }] };
}

function bubbleRowsOf(
  item: DerivableItem,
  label: string,
  format: ResponseFormat | null,
  labelIndex: Map<string, ResolvableItem>,
): RowsOrReason {
  if (SUPPORTED_ITEM_TYPES.has(item.type)) {
    const result = bubbleValuesOf(item);
    return 'reason' in result
      ? result
      : { rows: [{ label, values: result.values, teacherScore: false }] };
  }
  if (format?.kind === 'bubble_choice') return choiceRowsOf(item, label, labelIndex);
  if (format?.kind === 'score_bubbles') return teacherScoreRowsOf(item, label, format);
  return { reason: unsupportedReason(item, format) };
}

export function partitionDerivableItems(items: readonly DerivableItem[]): PartitionedItems {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const correctable: CorrectableItem[] = [];
  const excluded: LayoutExcludedItemModel[] = [];
  const seenLabels = new Set<string>();
  const labelIndex = buildPrintedLabelIndex(sorted);

  for (const item of sorted) {
    const label = printedLabelOf(item);
    const format = SUPPORTED_ITEM_TYPES.has(item.type) ? null : resolveResponseFormat(item);
    const vision = isVisionResponseFormat(format);
    const result = vision ? null : bubbleRowsOf(item, label, format, labelIndex);
    if (result !== null && 'reason' in result) {
      excluded.push({ itemId: item.id, printedNumber: label, reason: result.reason });
      continue;
    }

    const clash = [label, ...(result?.rows ?? []).map((row) => row.label)].find((candidate) =>
      seenLabels.has(candidate),
    );
    if (clash !== undefined) {
      excluded.push({
        itemId: item.id,
        printedNumber: label,
        reason: `Número impreso "${clash}" duplicado en el instrumento`,
      });
      continue;
    }

    if (vision) {
      seenLabels.add(label);
      correctable.push({ item, label, values: [], responseFormat: format, bubbleRows: [] });
      continue;
    }
    if (result === null) continue;

    seenLabels.add(label);
    for (const row of result.rows) seenLabels.add(row.label);
    const values =
      result.rows.length === 1 && result.rows[0]!.label === label ? result.rows[0]!.values : [];
    correctable.push({ item, label, values, responseFormat: null, bubbleRows: result.rows });
  }

  return { correctable, excluded };
}

export function expectedFieldLabels(correctable: readonly CorrectableItem[]): string[] {
  const labels: string[] = [];
  for (const entry of correctable) {
    if (entry.responseFormat !== null) {
      labels.push(entry.label);
      continue;
    }
    for (const row of entry.bubbleRows) labels.push(row.label);
  }
  return labels;
}

export function identityModeOf(spec: LayoutSpec | null | undefined): SheetIdentityMode {
  const identity = spec?.identity as LayoutSpec['identity'] | undefined;
  return identity?.mode ?? 'qr';
}

export function buildRutIdentityBubbles(): OmrBubble[] {
  const bubbles: OmrBubble[] = [];
  for (let group = 0; group <= RUT_DV_GROUP_INDEX; group++) {
    const values: string[] =
      group === RUT_DV_GROUP_INDEX
        ? [...RUT_DIGIT_VALUES, RUT_DV_EXTRA_VALUE]
        : [...RUT_DIGIT_VALUES];
    const centerX = RUT_COLUMN_START_X + group * RUT_COLUMN_SPACING_X;
    for (const [row, value] of values.entries()) {
      bubbles.push({
        value,
        center: { x: centerX, y: RUT_ROW_START_Y + row * RUT_ROW_SPACING_Y },
        radius: RUT_GRID_BUBBLE_RADIUS,
        group,
      });
    }
  }
  return bubbles;
}

function gridTopOf(identityMode: SheetIdentityMode): number {
  return identityMode === 'rut_bubbles' ? GRID_TOP_RUT_BUBBLES : GRID_TOP;
}

function buildIdentity(identityMode: SheetIdentityMode): LayoutSpec['identity'] {
  if (identityMode === 'rut_bubbles') {
    return {
      mode: 'rut_bubbles',
      region: {
        topLeft: { ...RUT_GRID_REGION.topLeft },
        bottomRight: { ...RUT_GRID_REGION.bottomRight },
      },
      bubbles: buildRutIdentityBubbles(),
    };
  }
  return {
    mode: identityMode,
    region: {
      topLeft: { ...SHEET_QR_IDENTITY_REGION.topLeft },
      bottomRight: { ...SHEET_QR_IDENTITY_REGION.bottomRight },
    },
  };
}

function buildField(bubbleRow: BubbleRow, slot: number, gridTop: number): LayoutField {
  const pageIndex = Math.floor(slot / SHEET_FIELDS_PER_PAGE);
  const slotInPage = slot % SHEET_FIELDS_PER_PAGE;
  const column = Math.floor(slotInPage / SHEET_MAX_ROWS_PER_COLUMN);
  const row = slotInPage % SHEET_MAX_ROWS_PER_COLUMN;

  const columnX = COLUMN_START_X[column]!;
  const rowHeight = (GRID_BOTTOM - gridTop) / SHEET_MAX_ROWS_PER_COLUMN;
  const centerY = gridTop + (row + 0.5) * rowHeight;

  const bubbles: OmrBubble[] = bubbleRow.values.map((value, index) => ({
    value,
    center: { x: columnX + FIRST_BUBBLE_OFFSET_X + index * BUBBLE_SPACING_X, y: centerY },
    radius: SHEET_BUBBLE_RADIUS,
  }));

  return {
    fieldId: fieldIdOf(bubbleRow.label),
    kind: 'bubble_group',
    printedNumber: bubbleRow.label,
    pageIndex,
    selectMode: 'single',
    bubbles,
    region: null,
  };
}

/**
 * `formId` sólo se escribe en el spec cuando existe: un layout sin forma no
 * lleva la clave y su `layoutHash` es bit a bit el de antes de las secciones
 * electivas (ver la nota del campo en omr-layout.schema.ts).
 */
export function deriveLayoutDraft(
  instrumentId: string,
  items: readonly DerivableItem[],
  identityMode: SheetIdentityMode = 'qr',
  formId: string | null = null,
): LayoutDraftModel {
  const { correctable, excluded } = partitionDerivableItems(items);
  const gridTop = gridTopOf(identityMode);
  const frame = sheetFrameSizeMm('letter', {
    sizeRatio: SHEET_FIDUCIAL_SIZE_RATIO,
    marginRatio: SHEET_FIDUCIAL_MARGIN_RATIO,
  });
  const gridRows: BubbleRow[] = [];
  for (const entry of correctable) {
    for (const row of entry.bubbleRows) if (!row.teacherScore) gridRows.push(row);
  }
  const fieldByLabel = new Map<string, LayoutField>();
  for (const [slot, row] of gridRows.entries()) {
    fieldByLabel.set(row.label, buildField(row, slot, gridTop));
  }
  for (const field of placeFlowFields(
    flowEntriesOf(correctable),
    gridRows.length,
    gridTop,
    frame,
  )) {
    fieldByLabel.set(field.printedNumber, field);
  }
  const fields = expectedFieldLabels(correctable).map((label) => fieldByLabel.get(label)!);
  let lastPageIndex = 0;
  for (const field of fields) lastPageIndex = Math.max(lastPageIndex, field.pageIndex);
  const pageCount = lastPageIndex + 1;

  const spec: LayoutSpec = {
    specVersion: 1,
    instrumentId,
    ...(formId === null ? {} : { formId }),
    pageCount,
    paper: 'letter',
    fiducials: {
      kind: 'corner_squares',
      sizeRatio: SHEET_FIDUCIAL_SIZE_RATIO,
      marginRatio: SHEET_FIDUCIAL_MARGIN_RATIO,
    },
    identity: buildIdentity(identityMode),
    fields,
  };

  return { spec, excludedItems: excluded };
}

function collectOverlapViolations(spec: LayoutSpec): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  type PlacedBubble = { fieldLabel: string; value: string; x: number; y: number; radius: number };

  const byPage = new Map<number, PlacedBubble[]>();
  let maxRadius = 0;
  for (const field of spec.fields) {
    for (const bubble of field.bubbles) {
      (byPage.get(field.pageIndex) ?? byPage.set(field.pageIndex, []).get(field.pageIndex)!).push({
        fieldLabel: field.printedNumber,
        value: bubble.value,
        x: bubble.center.x,
        y: bubble.center.y,
        radius: bubble.radius,
      });
      if (bubble.radius > maxRadius) maxRadius = bubble.radius;
    }
  }

  const cellSize = Math.max(maxRadius * 2, 1e-6);
  for (const bubbles of byPage.values()) {
    const grid = new Map<string, PlacedBubble[]>();
    for (const bubble of bubbles) {
      const cellX = Math.floor(bubble.x / cellSize);
      const cellY = Math.floor(bubble.y / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighbors = grid.get(`${cellX + dx}:${cellY + dy}`);
          if (!neighbors) continue;
          for (const other of neighbors) {
            const dist = Math.hypot(bubble.x - other.x, bubble.y - other.y);
            if (dist <= bubble.radius + other.radius) {
              violations.push({
                invariant: 2,
                message: `las burbujas "${other.value}" (pregunta ${other.fieldLabel}) y "${bubble.value}" (pregunta ${bubble.fieldLabel}) se solapan`,
              });
            }
          }
        }
      }
      const key = `${cellX}:${cellY}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(bubble);
    }
  }

  return violations;
}

function collectDigitGroupViolations(
  bubbles: readonly OmrBubble[],
  fieldLabel: string,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const groups = new Set<number>();
  let allGroupsPresent = true;

  for (const bubble of bubbles) {
    if (typeof bubble.group !== 'number' || !Number.isInteger(bubble.group)) {
      allGroupsPresent = false;
      violations.push({
        invariant: 6,
        message: `la burbuja "${bubble.value}" de ${fieldLabel} no declara su grupo (índice de dígito entero)`,
      });
      continue;
    }
    groups.add(bubble.group);
  }

  if (allGroupsPresent && groups.size > 0) {
    const max = Math.max(...groups);
    if (groups.size !== max + 1 || !groups.has(0)) {
      violations.push({
        invariant: 6,
        message: `los grupos de ${fieldLabel} deben ser contiguos desde 0 (encontrados: ${Array.from(
          groups,
        )
          .sort((a, b) => a - b)
          .join(', ')})`,
      });
    }
  }

  return violations;
}

function collectIdentityViolations(spec: LayoutSpec): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const bubbles = spec.identity.bubbles ?? null;

  if (spec.identity.mode === 'rut_bubbles') {
    if (bubbles === null || bubbles.length === 0) {
      violations.push({
        invariant: 6,
        message: 'el modo de identidad rut_bubbles requiere la grilla RUT en identity.bubbles',
      });
      return violations;
    }
    for (const bubble of bubbles) {
      const inRange =
        bubble.center.x - bubble.radius >= 0 &&
        bubble.center.x + bubble.radius <= 1 &&
        bubble.center.y - bubble.radius >= 0 &&
        bubble.center.y + bubble.radius <= 1;
      if (!inRange) {
        violations.push({
          invariant: 3,
          message: 'una burbuja de la grilla RUT queda fuera del rango 0–1 de la página',
        });
      }
    }
    violations.push(...collectDigitGroupViolations(bubbles, 'la grilla RUT'));
    return violations;
  }

  if (bubbles !== null) {
    violations.push({
      invariant: 6,
      message: `el modo de identidad "${spec.identity.mode}" no lleva grilla en identity.bubbles`,
    });
  }
  return violations;
}

function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? 1 : a > b ? -1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const [key, entry] of entries) out[key] = reorderKeys(entry);
    return out;
  }
  return value;
}

function regionsOverlap(a: OmrRegion, b: OmrRegion): boolean {
  return (
    a.topLeft.x < b.bottomRight.x - COORDINATE_EPSILON &&
    b.topLeft.x < a.bottomRight.x - COORDINATE_EPSILON &&
    a.topLeft.y < b.bottomRight.y - COORDINATE_EPSILON &&
    b.topLeft.y < a.bottomRight.y - COORDINATE_EPSILON
  );
}

function regionContains(outer: OmrRegion, inner: OmrRegion): boolean {
  return (
    inner.topLeft.x >= outer.topLeft.x - COORDINATE_EPSILON &&
    inner.topLeft.y >= outer.topLeft.y - COORDINATE_EPSILON &&
    inner.bottomRight.x <= outer.bottomRight.x + COORDINATE_EPSILON &&
    inner.bottomRight.y <= outer.bottomRight.y + COORDINATE_EPSILON
  );
}

function footprintOf(field: LayoutField): OmrRegion | null {
  if (field.region !== null) return field.region;
  if (field.bubbles.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const bubble of field.bubbles) {
    left = Math.min(left, bubble.center.x - bubble.radius);
    top = Math.min(top, bubble.center.y - bubble.radius);
    right = Math.max(right, bubble.center.x + bubble.radius);
    bottom = Math.max(bottom, bubble.center.y + bubble.radius);
  }
  return { topLeft: { x: left, y: top }, bottomRight: { x: right, y: bottom } };
}

function collectResponseFieldViolations(
  spec: LayoutSpec,
  itemIdByLabel: ReadonlyMap<string, string>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const identityRegions: OmrRegion[] = [spec.identity.region, SHEET_QR_IDENTITY_REGION];
  const footprintsByPage = new Map<number, { index: number; region: OmrRegion }[]>();
  for (const [index, field] of spec.fields.entries()) {
    const region = footprintOf(field);
    if (region === null) continue;
    (
      footprintsByPage.get(field.pageIndex) ??
      footprintsByPage.set(field.pageIndex, []).get(field.pageIndex)!
    ).push({ index, region });
  }

  for (const [index, field] of spec.fields.entries()) {
    const response = field.response;
    if (!response) continue;
    const label = `la pregunta "${field.printedNumber}"`;
    if (field.kind !== 'crop_region' || field.region === null) {
      violations.push({
        invariant: 8,
        message: `${label} declara casillas de respuesta pero no es una región de recorte con región definida`,
      });
      continue;
    }
    const fieldRegion = field.region;
    if (itemIdByLabel.get(field.printedNumber) !== response.itemId) {
      violations.push({
        invariant: 8,
        message: `${label} declara casillas de un ítem distinto al de su número impreso`,
      });
    }
    if (identityRegions.some((identity) => regionsOverlap(fieldRegion, identity))) {
      violations.push({
        invariant: 8,
        message: `${label} se superpone a la región de identidad: el recorte no puede incluir datos del alumno`,
      });
    }
    for (const other of footprintsByPage.get(field.pageIndex) ?? []) {
      if (other.index === index) continue;
      const otherField = spec.fields[other.index]!;
      if (otherField.response && other.index < index) continue;
      if (regionsOverlap(fieldRegion, other.region)) {
        violations.push({
          invariant: 8,
          message: `${label} se superpone a la pregunta "${otherField.printedNumber}"`,
        });
      }
    }
    for (const box of response.boxes) {
      if (!regionContains(fieldRegion, box.region)) {
        violations.push({
          invariant: 8,
          message: `la casilla "${box.partId}" de ${label} queda fuera de la región del campo`,
        });
      }
    }
  }
  return violations;
}

export function collectInvariantViolations(
  spec: LayoutSpec,
  items: readonly DerivableItem[],
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  const { correctable } = partitionDerivableItems(items);
  const correctableLabels = new Set(expectedFieldLabels(correctable));
  const allLabels = new Set(items.map((item) => printedLabelOf(item)));
  for (const field of spec.fields) {
    if (!allLabels.has(field.printedNumber) && !correctableLabels.has(field.printedNumber)) {
      violations.push({
        invariant: 1,
        message: `el número impreso "${field.printedNumber}" no existe en el instrumento`,
      });
    }
  }

  violations.push(...collectOverlapViolations(spec));

  for (const field of spec.fields) {
    for (const bubble of field.bubbles) {
      const inRange =
        bubble.center.x - bubble.radius >= 0 &&
        bubble.center.x + bubble.radius <= 1 &&
        bubble.center.y - bubble.radius >= 0 &&
        bubble.center.y + bubble.radius <= 1;
      if (!inRange) {
        violations.push({
          invariant: 3,
          message: `una burbuja de la pregunta ${field.printedNumber} queda fuera del rango 0–1 de la página`,
        });
      }
    }
  }

  const fieldLabels = new Map<string, number>();
  for (const field of spec.fields) {
    fieldLabels.set(field.printedNumber, (fieldLabels.get(field.printedNumber) ?? 0) + 1);
  }
  for (const [label, count] of fieldLabels) {
    if (count > 1) {
      violations.push({
        invariant: 4,
        message: `la pregunta "${label}" aparece ${count} veces en el layout`,
      });
    }
    if (!correctableLabels.has(label)) {
      violations.push({
        invariant: 4,
        message: `la pregunta "${label}" no es un ítem corregible del instrumento`,
      });
    }
  }
  for (const label of correctableLabels) {
    if (!fieldLabels.has(label)) {
      violations.push({
        invariant: 4,
        message: `falta la pregunta corregible "${label}" en el layout`,
      });
    }
  }

  for (const field of spec.fields) {
    if (field.pageIndex < 0 || field.pageIndex >= spec.pageCount) {
      violations.push({
        invariant: 5,
        message: `la pregunta "${field.printedNumber}" apunta a la página ${field.pageIndex}, fuera del rango [0, ${spec.pageCount})`,
      });
    }
  }

  violations.push(...collectIdentityViolations(spec));

  const itemIdByLabel = new Map(items.map((item) => [printedLabelOf(item), item.id]));
  violations.push(...collectResponseFieldViolations(spec, itemIdByLabel));

  for (const field of spec.fields) {
    if (field.kind === 'bubble_group' && field.bubbles.length === 0) {
      violations.push({
        invariant: 6,
        message: `la pregunta "${field.printedNumber}" es un grupo de burbujas sin burbujas`,
      });
    }
    if (field.kind === 'crop_region' && field.region === null) {
      violations.push({
        invariant: 6,
        message: `la pregunta "${field.printedNumber}" es una región de recorte sin región definida`,
      });
    }
    if (field.kind === 'digit_grid') {
      if (field.bubbles.length === 0) {
        violations.push({
          invariant: 6,
          message: `la pregunta "${field.printedNumber}" es una grilla de dígitos sin burbujas`,
        });
      }
      violations.push(
        ...collectDigitGroupViolations(field.bubbles, `la pregunta "${field.printedNumber}"`),
      );
    }
  }

  const originalHash = layoutHash(spec);
  const reorderedHash = layoutHash(reorderKeys(spec) as LayoutSpec);
  if (originalHash !== reorderedHash) {
    violations.push({
      invariant: 7,
      message: 'el hash del layout no es estable ante reordenamiento de claves',
    });
  }

  return violations.sort((a, b) => a.invariant - b.invariant);
}
