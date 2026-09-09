import { layoutHash, layoutSpecSchema, type ItemContent } from '@soe/types';
import {
  RUT_DV_GROUP_INDEX,
  SHEET_FIELDS_PER_PAGE,
  collectInvariantViolations,
  deriveLayoutDraft,
  partitionDerivableItems,
  type DerivableItem,
} from './sheet-layout.helpers';

const INSTRUMENT_ID = '11111111-1111-4111-8111-111111111111';

function mcItem(
  position: number,
  opts: { printedNumber?: string; keys?: string[]; id?: string } = {},
): DerivableItem {
  const keys = opts.keys ?? ['A', 'B', 'C', 'D'];
  return {
    id: opts.id ?? `item-${position}-${opts.printedNumber ?? ''}`,
    position,
    printedNumber: opts.printedNumber ?? null,
    type: 'multiple_choice',
    content: {
      stem: `Pregunta ${position}`,
      alternatives: keys.map((key) => ({ key, text: `Alt ${key}`, isCorrect: key === keys[0] })),
    } as ItemContent,
  };
}

function tfItem(position: number, printedNumber?: string): DerivableItem {
  return {
    id: `item-${position}`,
    position,
    printedNumber: printedNumber ?? null,
    type: 'true_false',
    content: { stem: `Afirmación ${position}`, correctAnswer: true } as ItemContent,
  };
}

function openItem(position: number): DerivableItem {
  return {
    id: `item-${position}`,
    position,
    printedNumber: null,
    type: 'open_ended',
    content: { prompt: 'Explica' } as ItemContent,
  };
}

describe('deriveLayoutDraft', () => {
  it('deriva un instrumento simple: MC con sus letras y V/F con V y F', () => {
    const items = [mcItem(1), mcItem(2, { keys: ['A', 'B', 'C'] }), tfItem(3)];
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);

    expect(draft.excludedItems).toEqual([]);
    expect(draft.spec.pageCount).toBe(1);
    expect(draft.spec.fields.map((f) => f.printedNumber)).toEqual(['1', '2', '3']);
    expect(draft.spec.fields[0]!.bubbles.map((b) => b.value)).toEqual(['A', 'B', 'C', 'D']);
    expect(draft.spec.fields[2]!.bubbles.map((b) => b.value)).toEqual(['V', 'F']);
    expect(draft.spec.fields[0]!.fieldId).toBe('f_001');
    expect(draft.spec.fields.every((f) => f.kind === 'bubble_group')).toBe(true);
    expect(() => layoutSpecSchema.parse(draft.spec)).not.toThrow();
  });

  it('excluye tipos no soportados declarando la razón', () => {
    const items = [mcItem(1), openItem(2), tfItem(3)];
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);

    expect(draft.spec.fields.map((f) => f.printedNumber)).toEqual(['1', '3']);
    expect(draft.excludedItems).toHaveLength(1);
    expect(draft.excludedItems[0]).toMatchObject({ itemId: 'item-2', printedNumber: '2' });
    expect(draft.excludedItems[0]!.reason).toContain('open_ended');
  });

  it('crece a más de una página cuando los ítems no caben en una (G4)', () => {
    const items = Array.from({ length: SHEET_FIELDS_PER_PAGE + 5 }, (_, i) => mcItem(i + 1));
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);

    expect(draft.spec.pageCount).toBe(2);
    expect(draft.spec.fields[SHEET_FIELDS_PER_PAGE - 1]!.pageIndex).toBe(0);
    expect(draft.spec.fields[SHEET_FIELDS_PER_PAGE]!.pageIndex).toBe(1);
    expect(() => layoutSpecSchema.parse(draft.spec)).not.toThrow();
  });

  it('un instrumento sin ítems corregibles produce cero fields y todos excluidos', () => {
    const items = [openItem(1), openItem(2)];
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);

    expect(draft.spec.fields).toEqual([]);
    expect(draft.spec.pageCount).toBe(1);
    expect(draft.excludedItems).toHaveLength(2);
  });

  it('respeta los printedNumber compuestos 19.1..19.5 (D17)', () => {
    const items = [
      mcItem(1),
      ...[1, 2, 3, 4, 5].map((sub, i) =>
        tfItem(2 + i, `19.${sub}`),
      ),
    ];
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);

    expect(draft.spec.fields.map((f) => f.printedNumber)).toEqual([
      '1',
      '19.1',
      '19.2',
      '19.3',
      '19.4',
      '19.5',
    ]);
    expect(draft.spec.fields[1]!.fieldId).toBe('f_019_1');
  });

  it('nunca genera burbujas solapadas ni fuera de rango, incluso a página llena con 6 alternativas', () => {
    const items = Array.from({ length: SHEET_FIELDS_PER_PAGE * 2 }, (_, i) =>
      mcItem(i + 1, { keys: ['A', 'B', 'C', 'D', 'E', 'F'] }),
    );
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);

    expect(draft.spec.pageCount).toBe(2);
    expect(draft.excludedItems).toEqual([]);
    expect(collectInvariantViolations(draft.spec, items)).toEqual([]);
  });

  it('excluye un MC con más alternativas de las que caben en la fila', () => {
    const items = [mcItem(1, { keys: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }), mcItem(2)];
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);

    expect(draft.spec.fields.map((f) => f.printedNumber)).toEqual(['2']);
    expect(draft.excludedItems[0]!.reason).toContain('7 alternativas');
  });

  it('excluye un número impreso duplicado en vez de dibujarlo dos veces', () => {
    const items = [mcItem(1, { printedNumber: '5', id: 'a' }), mcItem(2, { printedNumber: '5', id: 'b' })];
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);

    expect(draft.spec.fields).toHaveLength(1);
    expect(draft.excludedItems[0]).toMatchObject({ itemId: 'b', printedNumber: '5' });
    expect(draft.excludedItems[0]!.reason).toContain('duplicado');
  });
});

describe('partitionDerivableItems', () => {
  it('excluye un MC sin alternativas válidas', () => {
    const broken: DerivableItem = {
      id: 'x',
      position: 1,
      printedNumber: null,
      type: 'multiple_choice',
      content: { stem: 'sin alternativas' } as ItemContent,
    };
    const { correctable, excluded } = partitionDerivableItems([broken]);

    expect(correctable).toEqual([]);
    expect(excluded[0]!.reason).toContain('alternativas');
  });

  it('ordena por position aunque la lista venga desordenada', () => {
    const { correctable } = partitionDerivableItems([mcItem(3), mcItem(1), mcItem(2)]);
    expect(correctable.map((c) => c.label)).toEqual(['1', '2', '3']);
  });
});

describe('deriveLayoutDraft — identidad rut_bubbles (CD-10)', () => {
  const items = [mcItem(1), mcItem(2), tfItem(3)];

  it('la identidad trae la grilla RUT: 8 grupos de cuerpo + grupo DV con 0–9 y K', () => {
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items, 'rut_bubbles');
    const bubbles = draft.spec.identity.bubbles ?? [];

    expect(draft.spec.identity.mode).toBe('rut_bubbles');
    expect(new Set(bubbles.map((b) => b.group)).size).toBe(RUT_DV_GROUP_INDEX + 1);
    expect(bubbles.filter((b) => b.group === 0).map((b) => b.value)).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ]);
    expect(bubbles.filter((b) => b.group === RUT_DV_GROUP_INDEX).map((b) => b.value)).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'K',
    ]);
    expect(() => layoutSpecSchema.parse(draft.spec)).not.toThrow();
    expect(collectInvariantViolations(draft.spec, items)).toEqual([]);
  });

  it('la grilla queda dentro de la región identity y las preguntas empiezan debajo de ella', () => {
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items, 'rut_bubbles');
    const bubbles = draft.spec.identity.bubbles ?? [];
    const region = draft.spec.identity.region;

    for (const bubble of bubbles) {
      expect(bubble.center.x).toBeGreaterThanOrEqual(region.topLeft.x);
      expect(bubble.center.x).toBeLessThanOrEqual(region.bottomRight.x);
      expect(bubble.center.y).toBeGreaterThanOrEqual(region.topLeft.y);
      expect(bubble.center.y).toBeLessThanOrEqual(region.bottomRight.y);
    }

    const maxGridY = Math.max(...bubbles.map((b) => b.center.y + b.radius));
    const minFieldY = Math.min(
      ...draft.spec.fields.flatMap((f) => f.bubbles.map((b) => b.center.y - b.radius)),
    );
    expect(minFieldY).toBeGreaterThan(maxGridY);
  });

  it('el modo qr sigue derivando EXACTAMENTE igual que en el MVP y hashea distinto que rut_bubbles', () => {
    const qrImplicit = deriveLayoutDraft(INSTRUMENT_ID, items);
    const qrExplicit = deriveLayoutDraft(INSTRUMENT_ID, items, 'qr');
    const rut = deriveLayoutDraft(INSTRUMENT_ID, items, 'rut_bubbles');

    expect(qrImplicit.spec).toEqual(qrExplicit.spec);
    expect(qrImplicit.spec.identity.bubbles).toBeUndefined();
    expect(layoutHash(qrImplicit.spec)).toBe(layoutHash(qrExplicit.spec));
    expect(layoutHash(rut.spec)).not.toBe(layoutHash(qrImplicit.spec));
  });

  it('M4: un campo digit_grid con una burbuja sin group es un spec inválido', () => {
    const spec = deriveLayoutDraft(INSTRUMENT_ID, items).spec;
    const digitField = {
      fieldId: 'f_num',
      kind: 'digit_grid' as const,
      printedNumber: '1',
      pageIndex: 0,
      selectMode: 'single' as const,
      bubbles: [
        { value: '0', center: { x: 0.6, y: 0.3 }, radius: 0.008, group: 0 },
        { value: '1', center: { x: 0.6, y: 0.35 }, radius: 0.008 },
      ],
      region: null,
    };
    const broken = { ...spec, fields: [digitField] };

    const messages = collectInvariantViolations(broken, items).map((v) => v.message);
    expect(messages.some((m) => m.includes('no declara su grupo'))).toBe(true);
  });

  it('M4: un campo digit_grid con grupos no contiguos (0 y 2) es un spec inválido', () => {
    const spec = deriveLayoutDraft(INSTRUMENT_ID, items).spec;
    const digitField = {
      fieldId: 'f_num',
      kind: 'digit_grid' as const,
      printedNumber: '1',
      pageIndex: 0,
      selectMode: 'single' as const,
      bubbles: [
        { value: '0', center: { x: 0.6, y: 0.3 }, radius: 0.008, group: 0 },
        { value: '1', center: { x: 0.6, y: 0.35 }, radius: 0.008, group: 2 },
      ],
      region: null,
    };
    const broken = { ...spec, fields: [digitField] };

    const messages = collectInvariantViolations(broken, items).map((v) => v.message);
    expect(messages.some((m) => m.includes('contiguos desde 0'))).toBe(true);
    expect(messages.some((m) => m.includes('0, 2'))).toBe(true);
  });

  it('M4: un campo digit_grid con grupos contiguos 0..2 no agrega violaciones de grupos', () => {
    const spec = deriveLayoutDraft(INSTRUMENT_ID, items).spec;
    const digitField = {
      fieldId: 'f_num',
      kind: 'digit_grid' as const,
      printedNumber: '1',
      pageIndex: 0,
      selectMode: 'single' as const,
      bubbles: [0, 1, 2].map((group) => ({
        value: String(group),
        center: { x: 0.6 + group * 0.05, y: 0.3 },
        radius: 0.008,
        group,
      })),
      region: null,
    };
    const valid = { ...spec, fields: [digitField] };

    const messages = collectInvariantViolations(valid, items).map((v) => v.message);
    expect(messages.some((m) => m.includes('grupo'))).toBe(false);
  });

  it('M4: la grilla RUT con grupos no contiguos también viola el invariante', () => {
    const rut = deriveLayoutDraft(INSTRUMENT_ID, items, 'rut_bubbles').spec;
    const holed = {
      ...rut,
      identity: {
        ...rut.identity,
        bubbles: (rut.identity.bubbles ?? []).filter((bubble) => bubble.group !== 3),
      },
    };

    const messages = collectInvariantViolations(holed, items).map((v) => v.message);
    expect(messages.some((m) => m.includes('contiguos desde 0'))).toBe(true);
  });

  it('invariante de freeze: rut_bubbles sin grilla y qr con grilla son specs inválidos', () => {
    const rut = deriveLayoutDraft(INSTRUMENT_ID, items, 'rut_bubbles').spec;
    const qr = deriveLayoutDraft(INSTRUMENT_ID, items, 'qr').spec;

    const rutSinGrilla = { ...rut, identity: { ...rut.identity, bubbles: null } };
    const qrConGrilla = { ...qr, identity: { ...qr.identity, bubbles: rut.identity.bubbles } };

    expect(collectInvariantViolations(rutSinGrilla, items).map((v) => v.message).join(' ')).toContain(
      'grilla RUT',
    );
    expect(collectInvariantViolations(qrConGrilla, items).map((v) => v.message).join(' ')).toContain(
      'no lleva grilla',
    );
  });
});
