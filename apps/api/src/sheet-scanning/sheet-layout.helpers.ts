import {
  layoutHash,
  type ItemContent,
  type ItemType,
  type LayoutDraftModel,
  type LayoutExcludedItemModel,
  type LayoutField,
  type LayoutSpec,
  type OmrBubble,
} from '@soe/types';

export interface DerivableItem {
  id: string;
  position: number;
  printedNumber: string | null;
  type: ItemType;
  content: ItemContent;
}

export interface CorrectableItem {
  item: DerivableItem;
  label: string;
  values: string[];
}

export interface PartitionedItems {
  correctable: CorrectableItem[];
  excluded: LayoutExcludedItemModel[];
}

export interface InvariantViolation {
  invariant: number;
  message: string;
}

export const SHEET_FIDUCIAL_SIZE_RATIO = 0.025;
export const SHEET_FIDUCIAL_MARGIN_RATIO = 0.03;
export const SHEET_BUBBLE_RADIUS = 0.011;
export const SHEET_MAX_ROWS_PER_COLUMN = 25;
export const SHEET_COLUMNS_PER_PAGE = 3;
export const SHEET_MAX_BUBBLES_PER_FIELD = 6;
export const SHEET_FIELDS_PER_PAGE = SHEET_MAX_ROWS_PER_COLUMN * SHEET_COLUMNS_PER_PAGE;

const GRID_TOP = 0.18;
const GRID_BOTTOM = 0.97;
const COLUMN_START_X = [0.05, 0.37, 0.69] as const;
const FIRST_BUBBLE_OFFSET_X = 0.045;
const BUBBLE_SPACING_X = 0.05;
const ROW_HEIGHT = (GRID_BOTTOM - GRID_TOP) / SHEET_MAX_ROWS_PER_COLUMN;

const IDENTITY_REGION = {
  topLeft: { x: 0.78, y: 0.02 },
  bottomRight: { x: 0.98, y: 0.16 },
};

const TRUE_FALSE_VALUES = ['V', 'F'] as const;
const SUPPORTED_ITEM_TYPES: ReadonlySet<ItemType> = new Set(['multiple_choice', 'true_false']);

export function printedLabelOf(item: { position: number; printedNumber: string | null }): string {
  return item.printedNumber ?? String(item.position);
}

function fieldIdOf(label: string): string {
  const segments = label
    .split(/[^a-zA-Z0-9]+/)
    .filter((s) => s.length > 0)
    .map((segment, index) => (index === 0 && /^\d+$/.test(segment) ? segment.padStart(3, '0') : segment));
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

export function partitionDerivableItems(items: readonly DerivableItem[]): PartitionedItems {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const correctable: CorrectableItem[] = [];
  const excluded: LayoutExcludedItemModel[] = [];
  const seenLabels = new Set<string>();

  for (const item of sorted) {
    const label = printedLabelOf(item);

    if (!SUPPORTED_ITEM_TYPES.has(item.type)) {
      excluded.push({
        itemId: item.id,
        printedNumber: label,
        reason: `Tipo de ítem "${item.type}" no soportado por el lector: sólo selección múltiple y verdadero/falso`,
      });
      continue;
    }

    if (seenLabels.has(label)) {
      excluded.push({
        itemId: item.id,
        printedNumber: label,
        reason: `Número impreso "${label}" duplicado en el instrumento`,
      });
      continue;
    }

    const result = bubbleValuesOf(item);
    if ('reason' in result) {
      excluded.push({ itemId: item.id, printedNumber: label, reason: result.reason });
      continue;
    }

    seenLabels.add(label);
    correctable.push({ item, label, values: result.values });
  }

  return { correctable, excluded };
}

function buildField(entry: CorrectableItem, slot: number): LayoutField {
  const pageIndex = Math.floor(slot / SHEET_FIELDS_PER_PAGE);
  const slotInPage = slot % SHEET_FIELDS_PER_PAGE;
  const column = Math.floor(slotInPage / SHEET_MAX_ROWS_PER_COLUMN);
  const row = slotInPage % SHEET_MAX_ROWS_PER_COLUMN;

  const columnX = COLUMN_START_X[column]!;
  const centerY = GRID_TOP + (row + 0.5) * ROW_HEIGHT;

  const bubbles: OmrBubble[] = entry.values.map((value, index) => ({
    value,
    center: { x: columnX + FIRST_BUBBLE_OFFSET_X + index * BUBBLE_SPACING_X, y: centerY },
    radius: SHEET_BUBBLE_RADIUS,
  }));

  return {
    fieldId: fieldIdOf(entry.label),
    kind: 'bubble_group',
    printedNumber: entry.label,
    pageIndex,
    selectMode: 'single',
    bubbles,
    region: null,
  };
}

export function deriveLayoutDraft(
  instrumentId: string,
  items: readonly DerivableItem[],
): LayoutDraftModel {
  const { correctable, excluded } = partitionDerivableItems(items);
  const fields = correctable.map((entry, slot) => buildField(entry, slot));
  const pageCount = Math.max(1, Math.ceil(correctable.length / SHEET_FIELDS_PER_PAGE));

  const spec: LayoutSpec = {
    specVersion: 1,
    instrumentId,
    pageCount,
    paper: 'letter',
    fiducials: {
      kind: 'corner_squares',
      sizeRatio: SHEET_FIDUCIAL_SIZE_RATIO,
      marginRatio: SHEET_FIDUCIAL_MARGIN_RATIO,
    },
    identity: {
      mode: 'qr',
      region: {
        topLeft: { ...IDENTITY_REGION.topLeft },
        bottomRight: { ...IDENTITY_REGION.bottomRight },
      },
    },
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

export function collectInvariantViolations(
  spec: LayoutSpec,
  items: readonly DerivableItem[],
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  const allLabels = new Set(items.map((item) => printedLabelOf(item)));
  for (const field of spec.fields) {
    if (!allLabels.has(field.printedNumber)) {
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

  const { correctable } = partitionDerivableItems(items);
  const correctableLabels = new Set(correctable.map((entry) => entry.label));
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
