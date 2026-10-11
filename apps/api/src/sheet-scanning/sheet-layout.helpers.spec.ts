import { layoutHash, layoutSpecSchema, type ItemContent } from '@soe/types';
import {
  RESPONSE_MIN_BOX_MM,
  RUT_DV_GROUP_INDEX,
  SHEET_FIELDS_PER_PAGE,
  collectInvariantViolations,
  deriveLayoutDraft,
  partitionDerivableItems,
  sheetFrameSizeMm,
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
    type: 'oral_reading',
    content: { passage: 'Lee en voz alta' } as ItemContent,
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
    expect(draft.excludedItems[0]!.reason).toContain('oral_reading');
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

function uuidFor(position: number): string {
  return `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`;
}

function shortAnswerItem(position: number, acceptedAnswers: string[], extra: Record<string, unknown> = {}): DerivableItem {
  return {
    id: uuidFor(position),
    position,
    printedNumber: null,
    type: 'short_answer',
    content: { prompt: `Pregunta ${position}`, acceptedAnswers, ...extra } as ItemContent,
  };
}

function rubricItem(position: number): DerivableItem {
  return {
    id: uuidFor(position),
    position,
    printedNumber: null,
    type: 'rubric_scored',
    content: {
      prompt: 'Explica tu procedimiento',
      levels: [
        { code: '0', creditFraction: 0 },
        { code: '1', creditFraction: 1 },
      ],
    } as ItemContent,
  };
}

function formatItems(): DerivableItem[] {
  return [
    mcItem(1),
    shortAnswerItem(2, ['-135']),
    shortAnswerItem(3, ['10,962']),
    shortAnswerItem(4, ['21/10', '2 1/10']),
    shortAnswerItem(5, ['(7;3)']),
    shortAnswerItem(6, ['3-1-4-2']),
    shortAnswerItem(7, ['Cabeza, tórax, abdomen']),
    rubricItem(8),
  ];
}

describe('deriveLayoutDraft — campos de respuesta escrita por formato', () => {
  it('deriva un crop_region con response para cada formato de visión, en orden de posición', () => {
    const draft = deriveLayoutDraft(INSTRUMENT_ID, formatItems());

    expect(draft.excludedItems).toEqual([]);
    expect(() => layoutSpecSchema.parse(draft.spec)).not.toThrow();
    expect(draft.spec.fields.map((f) => f.printedNumber)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(draft.spec.fields[0]!.kind).toBe('bubble_group');
    expect(draft.spec.fields[0]!.response).toBeUndefined();

    const formats = draft.spec.fields.slice(1).map((f) => f.response?.format.kind);
    expect(formats).toEqual([
      'integer',
      'decimal',
      'fraction',
      'ordered_tuple',
      'sequence',
      'short_text',
      'free_text',
    ]);
    for (const field of draft.spec.fields.slice(1)) {
      expect(field.kind).toBe('crop_region');
      expect(field.response!.itemId).toBe(uuidFor(Number(field.printedNumber)));
    }
  });

  it('asigna partId y role por formato y el perfil de recorte según el largo de la respuesta', () => {
    const fields = deriveLayoutDraft(INSTRUMENT_ID, formatItems()).spec.fields;
    const rolesOf = (index: number) => fields[index]!.response!.boxes.map((b) => `${b.partId}:${b.role}`);

    expect(rolesOf(1)).toEqual(['sign:sign', ...Array.from({ length: 5 }, (_, i) => `char.${i}:char`)]);
    expect(rolesOf(2)).toEqual([
      'char.0:char',
      'char.1:char',
      'char.2:char',
      'char.3:char',
      'decimal_separator:decimal_separator',
      'char.4:char',
      'char.5:char',
      'char.6:char',
    ]);
    expect(rolesOf(3)).toEqual(['whole:whole', 'numerator:numerator', 'denominator:denominator']);
    expect(rolesOf(4)).toEqual(['components.0:tuple_component', 'components.1:tuple_component']);
    expect(rolesOf(5)).toEqual(Array.from({ length: 4 }, (_, i) => `elements.${i}:sequence_element`));
    expect(rolesOf(6)).toEqual(['lines.0:line']);
    expect(rolesOf(7)).toEqual(Array.from({ length: 6 }, (_, i) => `lines.${i}:line`));

    expect(fields.slice(1, 7).every((f) => f.response!.cropProfileId === 'short-answer@1')).toBe(true);
    expect(fields[7]!.response!.cropProfileId).toBe('free-text@1');
  });

  it('las casillas de caracteres son cuadradas y de al menos 8 mm', () => {
    const spec = deriveLayoutDraft(INSTRUMENT_ID, formatItems()).spec;
    const frame = sheetFrameSizeMm(spec.paper, spec.fiducials);
    for (const box of spec.fields[1]!.response!.boxes) {
      const widthMm = (box.region.bottomRight.x - box.region.topLeft.x) * frame.width;
      const heightMm = (box.region.bottomRight.y - box.region.topLeft.y) * frame.height;
      expect(widthMm).toBeCloseTo(heightMm, 2);
      expect(widthMm).toBeGreaterThanOrEqual(RESPONSE_MIN_BOX_MM);
    }
  });

  it('la fracción pone el numerador sobre el denominador con espacio para la raya', () => {
    const boxes = deriveLayoutDraft(INSTRUMENT_ID, formatItems()).spec.fields[3]!.response!.boxes;
    const numerator = boxes.find((b) => b.role === 'numerator')!;
    const denominator = boxes.find((b) => b.role === 'denominator')!;
    expect(numerator.region.topLeft.x).toBe(denominator.region.topLeft.x);
    expect(denominator.region.topLeft.y).toBeGreaterThan(numerator.region.bottomRight.y);
  });

  it('el layout derivado no viola ningún invariante y no toca la identidad', () => {
    for (const mode of ['qr', 'rut_bubbles'] as const) {
      const items = formatItems();
      const spec = deriveLayoutDraft(INSTRUMENT_ID, items, mode).spec;
      expect(collectInvariantViolations(spec, items)).toEqual([]);
    }
  });

  it('los campos de respuesta se ubican debajo de las burbujas y pasan de página cuando no caben', () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => mcItem(i + 1)),
      ...Array.from({ length: 6 }, (_, i) => rubricItem(11 + i)),
    ];
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);
    const responses = draft.spec.fields.filter((f) => f.response);

    expect(draft.spec.pageCount).toBeGreaterThan(1);
    expect(responses.some((f) => f.pageIndex === 0)).toBe(true);
    expect(responses.some((f) => f.pageIndex > 0)).toBe(true);
    expect(collectInvariantViolations(draft.spec, items)).toEqual([]);
  });

  it('matching y ordering siguen excluidos en esta fase con su motivo', () => {
    const matching: DerivableItem = {
      id: uuidFor(2),
      position: 2,
      printedNumber: null,
      type: 'matching',
      content: {} as ItemContent,
    };
    const draft = deriveLayoutDraft(INSTRUMENT_ID, [mcItem(1), matching]);
    expect(draft.spec.fields).toHaveLength(1);
    expect(draft.excludedItems[0]!.reason).toContain('bubble_choice');
  });

  it('un instrumento sólo de burbujas deriva el mismo hash que antes de F5b', () => {
    const items = [mcItem(1, { id: 'item-1' }), mcItem(2, { id: 'item-2' }), mcItem(3, { id: 'item-3' }), tfItem(4)];
    expect(layoutHash(deriveLayoutDraft(INSTRUMENT_ID, items, 'qr').spec)).toBe('f2ce4d77592b2762');
    expect(layoutHash(deriveLayoutDraft(INSTRUMENT_ID, items, 'rut_bubbles').spec)).toBe('7626aeb869d0b89e');
  });

  it('un instrumento sin ítems abiertos no materializa la clave response', () => {
    const items = [mcItem(1), tfItem(2)];
    expect(partitionDerivableItems(items).correctable.every((e) => e.responseFormat === null)).toBe(true);
    expect(deriveLayoutDraft(INSTRUMENT_ID, items).spec.fields.every((f) => !('response' in f))).toBe(true);
  });
});

describe('collectInvariantViolations — invariante 8 (campos de respuesta)', () => {
  it('rechaza un campo de respuesta superpuesto a la región de identidad', () => {
    const items = formatItems();
    const spec = structuredClone(deriveLayoutDraft(INSTRUMENT_ID, items).spec);
    spec.fields[1]!.region = { topLeft: { x: 0.7, y: 0.05 }, bottomRight: { x: 0.95, y: 0.15 } };
    const messages = collectInvariantViolations(spec, items).map((v) => `${v.invariant}:${v.message}`);
    expect(messages.some((m) => m.startsWith('8:') && m.includes('región de identidad'))).toBe(true);
  });

  it('rechaza un campo de respuesta superpuesto a otro campo', () => {
    const items = formatItems();
    const spec = structuredClone(deriveLayoutDraft(INSTRUMENT_ID, items).spec);
    spec.fields[2]!.region = structuredClone(spec.fields[1]!.region);
    spec.fields[2]!.response!.boxes = [];
    const messages = collectInvariantViolations(spec, items).map((v) => v.message);
    expect(messages.some((m) => m.includes('"2" se superpone a la pregunta "3"'))).toBe(true);
  });

  it('rechaza un campo de respuesta que pisa una fila de burbujas', () => {
    const items = formatItems();
    const spec = structuredClone(deriveLayoutDraft(INSTRUMENT_ID, items).spec);
    const bubble = spec.fields[0]!.bubbles[0]!;
    spec.fields[1]!.region = {
      topLeft: { x: bubble.center.x - 0.02, y: bubble.center.y - 0.01 },
      bottomRight: { x: bubble.center.x + 0.3, y: bubble.center.y + 0.05 },
    };
    const messages = collectInvariantViolations(spec, items).map((v) => v.message);
    expect(messages.some((m) => m.includes('se superpone a la pregunta "1"'))).toBe(true);
  });

  it('rechaza una casilla fuera de la región del campo', () => {
    const items = formatItems();
    const spec = structuredClone(deriveLayoutDraft(INSTRUMENT_ID, items).spec);
    spec.fields[1]!.response!.boxes[0]!.region.bottomRight.x = 0.99;
    const messages = collectInvariantViolations(spec, items).map((v) => v.message);
    expect(messages.some((m) => m.includes('casilla "sign"') && m.includes('fuera de la región'))).toBe(true);
  });

  it('rechaza casillas que declaran un ítem distinto al del número impreso', () => {
    const items = formatItems();
    const spec = structuredClone(deriveLayoutDraft(INSTRUMENT_ID, items).spec);
    spec.fields[1]!.response!.itemId = uuidFor(99);
    const messages = collectInvariantViolations(spec, items).map((v) => v.message);
    expect(messages.some((m) => m.includes('ítem distinto'))).toBe(true);
  });
});
