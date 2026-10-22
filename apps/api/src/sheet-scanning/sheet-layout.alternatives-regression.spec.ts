import { layoutHash, type ItemContent, type LayoutField } from '@soe/types';
import {
  collectInvariantViolations,
  deriveLayoutDraft,
  type DerivableItem,
} from './sheet-layout.helpers';

const INSTRUMENT_ID = '11111111-1111-4111-8111-111111111111';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function mc(position: number, optionCount = 4, printedNumber: string | null = null): DerivableItem {
  const keys = LETTERS.slice(0, optionCount);
  return {
    id: `item-${position}`,
    position,
    printedNumber,
    type: 'multiple_choice',
    content: {
      stem: `Pregunta ${position}`,
      alternatives: keys.map((key) => ({ key, text: `Alt ${key}`, isCorrect: key === keys[0] })),
    } as ItemContent,
  };
}

function tf(position: number): DerivableItem {
  return {
    id: `item-${position}`,
    position,
    printedNumber: null,
    type: 'true_false',
    content: { stem: `Afirmación ${position}`, correctAnswer: true } as ItemContent,
  };
}

function shortAnswer(position: number, acceptedAnswer: string): DerivableItem {
  return {
    id: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    position,
    printedNumber: null,
    type: 'short_answer',
    content: { prompt: `Pregunta ${position}`, acceptedAnswers: [acceptedAnswer] } as ItemContent,
  };
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

const ALTERNATIVES_ONLY_FIXTURES: Record<string, DerivableItem[]> = {
  'mc-10': range(10).map((p) => mc(p)),
  'mc-30-2a6-opciones': range(30).map((p) => mc(p, 2 + ((p - 1) % 5))),
  'mc-80': range(80).map((p) => mc(p)),
  'mc-160-varias-paginas': range(160).map((p) => mc(p)),
  'mc-y-vf': range(24).map((p) => (p % 3 === 0 ? tf(p) : mc(p))),
  'mc-con-numero-impreso': range(12).map((p) => mc(p, 4, p <= 6 ? String(p) : `14.${p - 6}`)),
  'mc-6-opciones': range(15).map((p) => mc(p, 6)),
};

const BASE_HASHES: Record<string, { qr: string; rut_bubbles: string; pageCount: number }> = {
  'mc-10': { qr: '49983f04b5bc9ade', rut_bubbles: '1c9c8866bae661f8', pageCount: 1 },
  'mc-30-2a6-opciones': { qr: 'fc9b3b77ad2b3bd8', rut_bubbles: 'c64c3ae588c7e986', pageCount: 1 },
  'mc-80': { qr: 'a3b1f1aa4614515a', rut_bubbles: 'f5e9ac1655b62be8', pageCount: 2 },
  'mc-160-varias-paginas': {
    qr: '205c66dfe2c50f7c',
    rut_bubbles: 'ef10705dbba2b89d',
    pageCount: 3,
  },
  'mc-y-vf': { qr: '861d8ddac0b97fde', rut_bubbles: '11b933ca1ed1e08a', pageCount: 1 },
  'mc-con-numero-impreso': {
    qr: 'becc314cad20b036',
    rut_bubbles: 'cf327337a9c08260',
    pageCount: 1,
  },
  'mc-6-opciones': { qr: '2d88f09e7daaf54d', rut_bubbles: '55dc4cf66163d00c', pageCount: 1 },
};

const IDENTITY_MODES = ['qr', 'rut_bubbles'] as const;

function bubbleGeometry(fields: readonly LayoutField[]) {
  return fields
    .filter((field) => field.kind === 'bubble_group')
    .map((field) => ({
      printedNumber: field.printedNumber,
      pageIndex: field.pageIndex,
      selectMode: field.selectMode,
      bubbles: field.bubbles,
    }));
}

describe('layoutHash de instrumentos sólo de alternativas (golden de la base previa a la visión, 3d99adde)', () => {
  it.each(Object.keys(ALTERNATIVES_ONLY_FIXTURES))(
    '%s conserva el hash y la cantidad de páginas de la base',
    (name) => {
      const items = ALTERNATIVES_ONLY_FIXTURES[name]!;
      const expected = BASE_HASHES[name]!;
      for (const mode of IDENTITY_MODES) {
        const { spec } = deriveLayoutDraft(INSTRUMENT_ID, items, mode);
        expect(layoutHash(spec)).toBe(expected[mode]);
        expect(spec.pageCount).toBe(expected.pageCount);
        expect(collectInvariantViolations(spec, items)).toEqual([]);
      }
    },
  );
});

describe('instrumento mixto: las burbujas de alternativas no se mueven por las respuestas escritas', () => {
  const alternatives = range(12).map((p) => mc(p, 2 + ((p - 1) % 5)));
  const written = [shortAnswer(13, '-135'), shortAnswer(14, '21/10'), shortAnswer(15, '10,962')];

  it.each(IDENTITY_MODES)(
    'con identidad %s la geometría de cada MC es la del instrumento sin escritas',
    (mode) => {
      const alone = deriveLayoutDraft(INSTRUMENT_ID, alternatives, mode).spec;
      const mixed = deriveLayoutDraft(INSTRUMENT_ID, [...alternatives, ...written], mode).spec;

      expect(bubbleGeometry(mixed.fields)).toEqual(bubbleGeometry(alone.fields));
      expect(mixed.fields.filter((field) => field.kind === 'crop_region')).toHaveLength(
        written.length,
      );
    },
  );

  it('intercalar escritas entre las alternativas tampoco mueve las burbujas', () => {
    const positions = [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14];
    const onlyAlternatives = positions.map((p) => mc(p, 2 + (p % 5)));
    const interleaved = [
      ...onlyAlternatives,
      shortAnswer(5, '-135'),
      shortAnswer(10, '21/10'),
    ].sort((left, right) => left.position - right.position);
    const alone = deriveLayoutDraft(INSTRUMENT_ID, onlyAlternatives).spec;
    const mixed = deriveLayoutDraft(INSTRUMENT_ID, interleaved).spec;

    expect(bubbleGeometry(mixed.fields)).toEqual(bubbleGeometry(alone.fields));
    expect(mixed.fields.filter((field) => field.kind === 'crop_region')).toHaveLength(2);
  });
});
