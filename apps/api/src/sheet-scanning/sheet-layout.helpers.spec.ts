import {
  CROP_PROFILES,
  cropBleedBox,
  getScoringStrategy,
  layoutHash,
  regionBox,
  type CropBox,
  type CropProfileRef,
  layoutSpecSchema,
  type ItemContent,
  type LayoutField,
  type LayoutSpec,
  type OmrRegion,
} from '@soe/types';
import {
  buildPrintedLabelIndex,
  resolveRowAnswers,
  toScoringAnswer,
} from '../answer-sheets/lib/composite-answers';
import { toParserResult } from './scan-result.adapter';
import {
  RESPONSE_MIN_BOX_MM,
  TEACHER_SCORE_FIELD_SUFFIX,
  isTeacherScoreField,
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
    shortAnswerItem(7, ['Pedro is cooking.']),
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

    expect(fields.slice(1, 7).every((f) => f.response!.cropProfileId === 'short-answer@2')).toBe(true);
    expect(fields[7]!.response!.cropProfileId).toBe('free-text@2');
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

function wordListItem(position: number): DerivableItem {
  return shortAnswerItem(position, ['cabeza, tórax, abdomen']);
}

function gapFillItem(position: number, gaps: Record<string, unknown>[]): DerivableItem {
  return {
    id: uuidFor(position),
    position,
    printedNumber: null,
    type: 'gap_fill',
    content: { textWithGaps: 'x', gaps } as ItemContent,
  };
}

function operationItem(position: number): DerivableItem {
  const gaps = [
    { position: 0, acceptedAnswers: ['30'], label: 'Decenas', partId: 'd' },
    { position: 1, acceptedAnswers: ['4'], label: 'Unidades', partId: 'u' },
    { position: 2, acceptedAnswers: ['34'], label: 'Total', partId: 't' },
  ];
  return {
    ...gapFillItem(position, gaps),
    content: {
      textWithGaps: '___ + ___ = ___',
      gaps,
      responseFormat: {
        kind: 'multi_box',
        boxes: [
          { partId: 'd', label: 'Decenas:', kind: 'integer' },
          { partId: 'u', label: 'Unidades:', kind: 'integer', operatorBefore: '+' },
          { partId: 't', label: 'Total:', kind: 'integer', operatorBefore: '=' },
        ],
      },
    } as ItemContent,
  };
}

function vertical(region: OmrRegion): { top: number; bottom: number } {
  return { top: region.topLeft.y, bottom: region.bottomRight.y };
}

function boxesOverlap(a: OmrRegion, b: OmrRegion): boolean {
  return (
    a.topLeft.x < b.bottomRight.x &&
    b.topLeft.x < a.bottomRight.x &&
    a.topLeft.y < b.bottomRight.y &&
    b.topLeft.y < a.bottomRight.y
  );
}

function sizeMm(spec: LayoutSpec, region: OmrRegion): { width: number; height: number } {
  const frame = sheetFrameSizeMm(spec.paper, spec.fiducials);
  return {
    width: (region.bottomRight.x - region.topLeft.x) * frame.width,
    height: (region.bottomRight.y - region.topLeft.y) * frame.height,
  };
}

describe('deriveLayoutDraft — formatos word_list, short_text y multi_box (F10b)', () => {
  const items = [
    mcItem(1),
    wordListItem(2),
    shortAnswerItem(3, ['El agua se evapora con el calor del sol y luego cae como lluvia']),
    gapFillItem(4, [
      { position: 0, acceptedAnswers: ['3'], label: 'Decenas', partId: 'd' },
      { position: 1, acceptedAnswers: ['4'], label: 'Unidades', partId: 'u' },
    ]),
    operationItem(5),
  ];
  const spec = deriveLayoutDraft(INSTRUMENT_ID, items).spec;
  const byNumber = new Map(spec.fields.map((field) => [field.printedNumber, field]));

  it('deriva un campo de visión por formato, sin exclusiones ni violaciones', () => {
    const draft = deriveLayoutDraft(INSTRUMENT_ID, items);
    expect(draft.excludedItems).toEqual([]);
    expect(() => layoutSpecSchema.parse(draft.spec)).not.toThrow();
    expect(spec.fields.slice(1).map((f) => f.response?.format.kind)).toEqual([
      'word_list',
      'short_text',
      'multi_box',
      'multi_box',
    ]);
    for (const mode of ['qr', 'rut_bubbles'] as const) {
      expect(
        collectInvariantViolations(deriveLayoutDraft(INSTRUMENT_ID, items, mode).spec, items),
      ).toEqual([]);
    }
  });

  it('word_list imprime una casilla por palabra esperada', () => {
    const boxes = byNumber.get('2')!.response!.boxes;
    expect(boxes.map((b) => `${b.partId}:${b.role}`)).toEqual([
      'words.0:word',
      'words.1:word',
      'words.2:word',
    ]);
    for (const box of boxes)
      expect(sizeMm(spec, box.region).height).toBeGreaterThanOrEqual(RESPONSE_MIN_BOX_MM);
  });

  it('short_text imprime renglones según maxWords', () => {
    const field = byNumber.get('3')!;
    expect(field.response!.format).toEqual({ kind: 'short_text', maxWords: 16 });
    expect(field.response!.boxes.map((b) => b.role)).toEqual(['line', 'line']);
  });

  it('multi_box sin signos conserva la columna de rótulos a la izquierda', () => {
    const field = byNumber.get('4')!;
    const [first, second] = field.response!.boxes;
    expect(first!.region.topLeft.x).toBe(second!.region.topLeft.x);
    expect(first!.region.topLeft.x).toBeGreaterThan(field.region!.topLeft.x);
    expect(vertical(second!.region).top).toBeGreaterThan(vertical(first!.region).bottom);
  });

  it('multi_box con signos ubica las casillas en fila y reserva espacio para el signo y el rótulo', () => {
    const field = byNumber.get('5')!;
    const boxes = field.response!.boxes;
    expect(boxes.map((b) => `${b.partId}:${b.role}`)).toEqual(['d:word', 'u:word', 't:word']);
    const frame = sheetFrameSizeMm(spec.paper, spec.fiducials);
    for (let index = 1; index < boxes.length; index++) {
      const previous = boxes[index - 1]!.region;
      const current = boxes[index]!.region;
      expect(current.topLeft.y).toBeCloseTo(previous.topLeft.y, 6);
      const gapMm = (current.topLeft.x - previous.bottomRight.x) * frame.width;
      expect(gapMm).toBeGreaterThanOrEqual(8 + 'Unidades:'.length);
    }
    for (const box of boxes) {
      expect(sizeMm(spec, box.region).height).toBeGreaterThanOrEqual(RESPONSE_MIN_BOX_MM);
      for (const other of boxes) {
        if (other !== box) expect(boxesOverlap(box.region, other.region)).toBe(false);
      }
    }
  });

  it('agregar un signo opcional a multi_box no cambia el hash de los layouts de visión ya derivables', () => {
    const legacy = [
      mcItem(1, { id: uuidFor(1) }),
      shortAnswerItem(2, ['-135']),
      shortAnswerItem(3, ['10,962']),
      shortAnswerItem(4, ['21/10', '2 1/10']),
      shortAnswerItem(5, ['(7;3)']),
      shortAnswerItem(6, ['3-1-4-2']),
      shortAnswerItem(7, ['Pedro is cooking.']),
      rubricItem(8),
      wordListItem(9),
      gapFillItem(10, [
        { position: 0, acceptedAnswers: ['3'], label: 'Decenas' },
        { position: 1, acceptedAnswers: ['4'], label: 'Unidades' },
      ]),
    ];
    legacy[0] = {
      ...legacy[0]!,
      content: {
        stem: 'x',
        alternatives: ['A', 'B', 'C', 'D'].map((key) => ({
          key,
          text: key,
          isCorrect: key === 'A',
        })),
      } as ItemContent,
    };
    const withV1CropProfiles = (spec: LayoutSpec): LayoutSpec => ({
      ...spec,
      fields: spec.fields.map((field) =>
        field.response
          ? {
              ...field,
              response: {
                ...field.response,
                cropProfileId: field.response.cropProfileId.replace(/@2$/, '@1'),
              },
            }
          : field,
      ),
    });
    const qr = deriveLayoutDraft(INSTRUMENT_ID, legacy, 'qr').spec;
    const rut = deriveLayoutDraft(INSTRUMENT_ID, legacy, 'rut_bubbles').spec;
    expect(layoutHash(withV1CropProfiles(qr))).toBe('67ffca863532fa57');
    expect(layoutHash(withV1CropProfiles(rut))).toBe('755b2fb018046f26');
    expect(layoutHash(qr)).toBe('1bd231149a3f753a');
    expect(layoutHash(rut)).toBe('c8923ae68a8ca568');
  });
});

function matchingItem(position: number, printedNumber: string | null = null): DerivableItem {
  return {
    id: uuidFor(position),
    position,
    printedNumber,
    type: 'matching',
    content: {
      prompt: 'Une cada animal con su grupo',
      leftItems: [
        { id: 'l1', text: 'Perro', label: 'A.1' },
        { id: 'l2', text: 'Águila', label: 'A.2' },
        { id: 'l3', text: 'Salmón', label: 'A.3' },
      ],
      rightItems: [
        { id: 'mamifero', text: 'Mamífero', label: 'a' },
        { id: 'ave', text: 'Ave', label: 'b' },
        { id: 'pez', text: 'Pez', label: 'c' },
        { id: 'reptil', text: 'Reptil', label: 'd' },
      ],
      correctPairs: [
        { leftId: 'l1', rightId: 'mamifero' },
        { leftId: 'l2', rightId: 'ave' },
        { leftId: 'l3', rightId: 'pez' },
      ],
    } as ItemContent,
  };
}

function orderingItem(position: number): DerivableItem {
  return {
    id: uuidFor(position),
    position,
    printedNumber: null,
    type: 'ordering',
    content: {
      prompt: 'Ordena las etapas',
      items: [
        { id: 'semilla', text: 'Semilla' },
        { id: 'brote', text: 'Brote' },
        { id: 'planta', text: 'Planta' },
        { id: 'flor', text: 'Flor' },
      ],
      correctOrder: ['semilla', 'brote', 'planta', 'flor'],
    } as ItemContent,
  };
}

function sequenceBubbleItem(position: number): DerivableItem {
  return shortAnswerItem(position, ['3-1-4-2'], { responseFormat: { kind: 'bubble_choice' } });
}

function scoreItem(position: number, levels: string[] = ['0', '1', '2']): DerivableItem {
  return {
    id: uuidFor(position),
    position,
    printedNumber: null,
    type: 'rubric_scored',
    content: {
      prompt: 'Explica tu procedimiento',
      levels: [
        { code: '0', creditFraction: 0 },
        { code: '1', creditFraction: 0.5 },
        { code: '2', creditFraction: 1 },
      ],
      responseFormat: { kind: 'score_bubbles', levels },
    } as ItemContent,
  };
}

function bubbleFieldsOf(spec: LayoutSpec, prefix: string): LayoutField[] {
  return spec.fields.filter((field) => field.printedNumber.startsWith(`${prefix}.`));
}

describe('deriveLayoutDraft — burbujas de pareados, secuencias y puntaje docente (F10b)', () => {
  const items = [
    mcItem(1),
    matchingItem(2),
    orderingItem(3),
    sequenceBubbleItem(4),
    scoreItem(5),
    rubricItem(6),
  ];
  const draft = deriveLayoutDraft(INSTRUMENT_ID, items);
  const spec = draft.spec;

  it('el pareado da un grupo por término con una burbuja por opción, rotulado con su etiqueta', () => {
    expect(draft.excludedItems).toEqual([]);
    const rows = bubbleFieldsOf(spec, '2');
    expect(rows.map((f) => f.printedNumber)).toEqual(['2.A1', '2.A2', '2.A3']);
    for (const row of rows) {
      expect(row.kind).toBe('bubble_group');
      expect(row.bubbles.map((b) => b.value)).toEqual(['A', 'B', 'C', 'D']);
    }
  });

  it('el ordenamiento y la secuencia declarada dan un grupo por posición', () => {
    const ordering = bubbleFieldsOf(spec, '3');
    expect(ordering.map((f) => f.printedNumber)).toEqual(['3.1', '3.2', '3.3', '3.4']);
    expect(ordering[0]!.bubbles.map((b) => b.value)).toEqual(['A', 'B', 'C', 'D']);
    const sequence = bubbleFieldsOf(spec, '4');
    expect(sequence.map((f) => f.printedNumber)).toEqual(['4.1', '4.2', '4.3', '4.4']);
    expect(sequence[0]!.bubbles.map((b) => b.value)).toEqual(['1', '2', '3', '4']);
  });

  it('el puntaje docente es un grupo de burbujas por nivel, marcado como tal, y la rúbrica sin declarar sigue por visión', () => {
    const score = spec.fields.find((f) => f.printedNumber === '5')!;
    expect(score.kind).toBe('bubble_group');
    expect(score.fieldId).toBe(`f_005${TEACHER_SCORE_FIELD_SUFFIX}`);
    expect(isTeacherScoreField(score)).toBe(true);
    expect(score.bubbles.map((b) => b.value)).toEqual(['0', '1', '2']);
    expect(score.response).toBeUndefined();
    const rubric = spec.fields.find((f) => f.printedNumber === '6')!;
    expect(rubric.kind).toBe('crop_region');
    expect(rubric.response!.format.kind).toBe('free_text');
    expect(spec.fields.filter(isTeacherScoreField)).toHaveLength(1);
  });

  it('respeta los invariantes en ambos modos de identidad y valida contra el schema', () => {
    expect(() => layoutSpecSchema.parse(spec)).not.toThrow();
    for (const mode of ['qr', 'rut_bubbles'] as const) {
      expect(
        collectInvariantViolations(deriveLayoutDraft(INSTRUMENT_ID, items, mode).spec, items),
      ).toEqual([]);
    }
  });

  it('el invariante 4 detecta una fila de pareado faltante', () => {
    const broken = structuredClone(spec);
    broken.fields = broken.fields.filter((f) => f.printedNumber !== '2.A2');
    const messages = collectInvariantViolations(broken, items).map((v) => v.message);
    expect(messages).toContain('falta la pregunta corregible "2.A2" en el layout');
  });

  it('excluye con motivo lo que no se puede imprimir como burbujas', () => {
    const tooMany = matchingItem(2);
    (tooMany.content as { rightItems: { id: string; text: string }[] }).rightItems.push(
      { id: 'anfibio', text: 'Anfibio' },
      { id: 'insecto', text: 'Insecto' },
      { id: 'molusco', text: 'Molusco' },
    );
    const unknownLevel = scoreItem(3, ['0', '1', '3']);
    const declaredOnGap = gapFillItem(4, [{ position: 0, acceptedAnswers: ['3'] }]);
    (declaredOnGap.content as { responseFormat?: unknown }).responseFormat = {
      kind: 'bubble_choice',
    };
    const scoreOnShortAnswer = shortAnswerItem(5, ['3'], {
      responseFormat: { kind: 'score_bubbles', levels: ['0', '1'] },
    });
    const result = deriveLayoutDraft(INSTRUMENT_ID, [
      mcItem(1),
      tooMany,
      unknownLevel,
      declaredOnGap,
      scoreOnShortAnswer,
    ]);
    expect(result.spec.fields.map((f) => f.printedNumber)).toEqual(['1']);
    const reasons = result.excludedItems.map((e) => `${e.printedNumber}: ${e.reason}`);
    expect(reasons[0]).toContain('7 opciones');
    expect(reasons[1]).toContain('3 de las burbujas de puntaje no existen');
    expect(reasons[2]).toContain('bubble_choice');
    expect(reasons[3]).toContain('solo aplican a ítems de rúbrica');
  });

  it('excluye el pareado cuando una fila choca con otro número impreso', () => {
    const items2 = [matchingItem(1, '9'), mcItem(2, { printedNumber: '9.A1', id: uuidFor(2) })];
    const result = deriveLayoutDraft(INSTRUMENT_ID, items2);
    expect(result.spec.fields.map((f) => f.printedNumber)).toEqual(['9.A1']);
    expect(result.excludedItems[0]!.reason).toContain('"9.A1"');
  });

  it('las filas se numeran por posición cuando los términos no tienen etiqueta', () => {
    const unlabeled = matchingItem(7);
    const content = unlabeled.content as {
      leftItems: { id: string; text: string; label?: string }[];
    };
    content.leftItems = content.leftItems.map(({ id, text }) => ({ id, text }));
    const rows = deriveLayoutDraft(INSTRUMENT_ID, [unlabeled]).spec.fields;
    expect(rows.map((f) => f.printedNumber)).toEqual(['7.1', '7.2', '7.3']);
  });
});

describe('ingesta de las burbujas hasta la estrategia (F10b)', () => {
  const items = [matchingItem(2), orderingItem(3), sequenceBubbleItem(4), scoreItem(5)];
  const spec = deriveLayoutDraft(INSTRUMENT_ID, items).spec;
  const index = buildPrintedLabelIndex(items);

  function scoreWith(marks: Record<string, string | null>) {
    const parsed = toParserResult([
      {
        sequence: 1,
        studentRut: null,
        studentFullName: null,
        marks: spec.fields.map((field) => {
          const value = marks[field.printedNumber] ?? null;
          return {
            printedNumber: field.printedNumber,
            state: value === null ? ('blank' as const) : ('marked' as const),
            value,
          };
        }),
      },
    ]);
    const resolved = resolveRowAnswers(index, parsed.rows[0]!.answers);
    expect(resolved.unexpectedCompositePositions).toEqual([]);
    return new Map(
      items.map((item) => {
        const rawAnswer = toScoringAnswer(item, resolved.byPosition.get(item.position));
        const result = getScoringStrategy(item.type).score({
          item: { id: item.id, type: item.type, content: item.content, maxScore: 2 },
          rawAnswer,
        });
        return [item.position, { rawAnswer, result }];
      }),
    );
  }

  it('las respuestas correctas puntúan el máximo en cada estrategia', () => {
    const scored = scoreWith({
      '2.A1': 'A',
      '2.A2': 'B',
      '2.A3': 'C',
      '3.1': 'A',
      '3.2': 'B',
      '3.3': 'C',
      '3.4': 'D',
      '4.1': '3',
      '4.2': '1',
      '4.3': '4',
      '4.4': '2',
      '5': '2',
    });
    expect(scored.get(2)!.rawAnswer).toEqual({ l1: 'mamifero', l2: 'ave', l3: 'pez' });
    expect(scored.get(3)!.rawAnswer).toEqual(['semilla', 'brote', 'planta', 'flor']);
    expect(scored.get(4)!.rawAnswer).toBe('3-1-4-2');
    for (const position of [2, 3, 4, 5]) {
      expect(scored.get(position)!.result).toMatchObject({ isCorrect: true, rawScore: 2 });
    }
  });

  it('una marca equivocada o en blanco no puntúa y el nivel docente da su fracción', () => {
    const scored = scoreWith({
      '2.A1': 'A',
      '2.A2': 'C',
      '3.1': 'B',
      '3.2': 'A',
      '3.3': 'C',
      '3.4': 'D',
      '4.1': '3',
      '4.3': '4',
      '4.4': '2',
      '5': '1',
    });
    expect(scored.get(2)!.result).toMatchObject({ isCorrect: false, rawScore: 0 });
    expect(scored.get(3)!.result).toMatchObject({ isCorrect: false, rawScore: 0 });
    expect(scored.get(4)!.rawAnswer).toBe('3--4-2');
    expect(scored.get(4)!.result.isCorrect).toBe(false);
    expect(scored.get(5)!.result).toMatchObject({ isCorrect: false, rawScore: 1 });
  });

  it('sin marcas el ítem queda sin respuesta y el puntaje docente pendiente', () => {
    const scored = scoreWith({});
    expect(scored.get(3)!.rawAnswer).toBeNull();
    expect(scored.get(4)!.rawAnswer).toBeNull();
    expect(scored.get(5)!.result).toMatchObject({ requiresManualGrading: true });
  });
});

describe('perfil de recorte de los campos derivados (fotos reales: P8 leída como P7)', () => {
  function footprint(field: LayoutField, frame: { width: number; height: number }): CropBox {
    if (field.region) return regionBox(field.region, frame);
    const xs = field.bubbles.flatMap((b) => [b.center.x - b.radius, b.center.x + b.radius]);
    const ys = field.bubbles.flatMap((b) => [
      b.center.y * frame.height - b.radius * frame.width,
      b.center.y * frame.height + b.radius * frame.width,
    ]);
    return {
      x0: Math.min(...xs) * frame.width,
      x1: Math.max(...xs) * frame.width,
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    };
  }

  function intersects(a: CropBox, b: CropBox): boolean {
    return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  }

  it.each([
    ['formatos numéricos y de desarrollo', formatItems()],
    [
      'lista de palabras, renglón y casillas con signos',
      [mcItem(1), wordListItem(2), shortAnswerItem(3, ['producto']), operationItem(4), mcItem(5)],
    ],
  ])('%s: el margen del recorte no alcanza a ningún campo vecino', (_name, items) => {
    const spec = deriveLayoutDraft(INSTRUMENT_ID, items).spec;
    const frame = sheetFrameSizeMm(spec.paper, spec.fiducials);
    for (const field of spec.fields.filter((f) => f.response && f.region)) {
      const profile = CROP_PROFILES[field.response!.cropProfileId as CropProfileRef];
      const neighbors = spec.fields
        .filter((other) => other !== field && other.pageIndex === field.pageIndex)
        .map((other) => footprint(other, frame));
      const bleed = cropBleedBox(regionBox(field.region!, frame), profile, neighbors);
      const reached = neighbors.filter((neighbor) => intersects(bleed, neighbor));
      expect({ field: field.printedNumber, reached }).toEqual({ field: field.printedNumber, reached: [] });
    }
  });

  it('el margen deja aire alrededor de la región', () => {
    const spec = deriveLayoutDraft(INSTRUMENT_ID, formatItems()).spec;
    const frame = sheetFrameSizeMm(spec.paper, spec.fiducials);
    for (const field of spec.fields.filter((f) => f.response && f.region)) {
      const profile = CROP_PROFILES[field.response!.cropProfileId as CropProfileRef];
      const region = regionBox(field.region!, frame);
      const bleed = cropBleedBox(region, profile, []);
      expect(region.y0 - bleed.y0).toBeGreaterThanOrEqual(1);
    }
  });
});
