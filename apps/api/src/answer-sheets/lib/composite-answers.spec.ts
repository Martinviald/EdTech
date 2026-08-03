import type { ItemContent } from '@soe/types';
import {
  buildPrintedLabelIndex,
  resolveRowAnswers,
  resolveScanLabel,
  toScoringAnswer,
  type ResolvableItem,
} from './composite-answers';
import { assignAnswer, questionColumnToLabel } from './parsers/parser.types';

const matchingContent = {
  leftItems: [
    { id: 'B.1', text: 'uno', label: 'B.1' },
    { id: 'B.2', text: 'dos', label: 'B.2' },
    { id: 'B.3', text: 'tres', label: 'B.3' },
    { id: 'B.4', text: 'cuatro', label: 'B.4' },
  ],
  rightItems: [
    { id: 'A.1', text: 'a' },
    { id: 'A.2', text: 'b' },
    { id: 'A.3', text: 'c' },
    { id: 'A.6', text: 'f' },
  ],
  correctPairs: [
    { leftId: 'B.1', rightId: 'A.3' },
    { leftId: 'B.2', rightId: 'A.1' },
    { leftId: 'B.3', rightId: 'A.2' },
    { leftId: 'B.4', rightId: 'A.6' },
  ],
} as unknown as ItemContent;

function mcq(position: number, printedNumber?: string): ResolvableItem {
  return { position, printedNumber, type: 'multiple_choice', content: {} as ItemContent };
}

describe('questionColumnToLabel', () => {
  it('quita el prefijo del proveedor y PRESERVA la sub-numeración', () => {
    expect(questionColumnToLabel('Q12')).toBe('12');
    expect(questionColumnToLabel('Q01')).toBe('1');
    expect(questionColumnToLabel('Q14.2')).toBe('14.2');
    expect(questionColumnToLabel('7B1')).toBe('7B1');
    expect(questionColumnToLabel('p9.1')).toBe('9.1');
  });

  it('descarta columnas sin dígitos o con número base 0', () => {
    expect(questionColumnToLabel('Nombre')).toBeNull();
    expect(questionColumnToLabel('Q0')).toBeNull();
  });
});

describe('assignAnswer', () => {
  it('no colapsa columnas sub-numeradas distintas', () => {
    const answers: Record<string, string | null> = {};
    assignAnswer(answers, 'Q14.1', 'a');
    assignAnswer(answers, 'Q14.2', 'b');
    assignAnswer(answers, 'Q14.3', '');
    expect(answers).toEqual({ '14.1': 'A', '14.2': 'B', '14.3': null });
  });
});

describe('buildPrintedLabelIndex / resolveScanLabel', () => {
  // Forma real de Ciencias 8° 2026: el cuadernillo imprime 14.1..14.5 y la
  // extracción separó cada sub-pregunta en su propia posición correlativa.
  const items: ResolvableItem[] = [
    mcq(13),
    mcq(14, '14.1'),
    mcq(15, '14.2'),
    mcq(16, '14.3'),
    { position: 7, type: 'matching', content: matchingContent },
  ];
  const index = buildPrintedLabelIndex(items);

  it('resuelve el número impreso a su posición real, no a la base', () => {
    expect(resolveScanLabel(index, '14.2', 'B')).toEqual({
      kind: 'item',
      item: items[2],
      value: 'B',
    });
  });

  it('un ítem sin printedNumber se resuelve por su posición', () => {
    expect(resolveScanLabel(index, '13', 'A')).toEqual({
      kind: 'item',
      item: items[0],
      value: 'A',
    });
  });

  it('una etiqueta que no es un número impreso se parte en base + sub-etiqueta', () => {
    expect(resolveScanLabel(index, '7B1', 'A.4')).toEqual({
      kind: 'sub',
      item: items[4],
      subKey: 'B1',
      value: 'A.4',
    });
  });

  it('una columna ajena al instrumento queda sin resolver, no se inventa', () => {
    expect(resolveScanLabel(index, '99', 'A')).toEqual({
      kind: 'unmatched',
      label: '99',
      value: 'A',
    });
  });
});

describe('resolveRowAnswers', () => {
  const items: ResolvableItem[] = [
    mcq(14, '14.1'),
    mcq(15, '14.2'),
    mcq(16, '14.3'),
    mcq(17, '14.4'),
    mcq(18, '14.5'),
    { position: 7, type: 'matching', content: matchingContent },
  ];
  const index = buildPrintedLabelIndex(items);

  // Ésta es la regresión que motivó el cambio: antes las 5 columnas colapsaban
  // en la posición 14 y ganaba la última, perdiendo 4 respuestas en silencio.
  it('cada sub-numeración impresa va a SU ítem, no se agrupan', () => {
    const { byPosition, unexpectedCompositePositions } = resolveRowAnswers(index, {
      '14.1': 'A',
      '14.2': 'B',
      '14.3': 'C',
      '14.4': 'D',
      '14.5': 'E',
    });
    expect(Object.fromEntries(byPosition)).toEqual({
      14: 'A',
      15: 'B',
      16: 'C',
      17: 'D',
      18: 'E',
    });
    expect(unexpectedCompositePositions).toEqual([]);
  });

  it('las sub-respuestas de un pareado sí se agrupan en su único ítem', () => {
    const { byPosition } = resolveRowAnswers(index, {
      '7B1': 'A.4',
      '7B2': 'A.5',
      '7B3': 'A.2',
      '7B4': 'A.6',
    });
    expect(byPosition.get(7)).toEqual({ B1: 'A.4', B2: 'A.5', B3: 'A.2', B4: 'A.6' });
  });

  it('reporta las columnas que no corresponden a ninguna pregunta', () => {
    const { unmatchedLabels } = resolveRowAnswers(index, { '99': 'A', '14.1': 'B' });
    expect(unmatchedLabels).toEqual(['99']);
  });

  it('marca la sub-numeración de un ítem que no es compuesto', () => {
    const single = buildPrintedLabelIndex([mcq(9)]);
    const { unexpectedCompositePositions } = resolveRowAnswers(single, {
      '9.1': 'A',
      '9.2': 'B',
    });
    expect(unexpectedCompositePositions).toEqual([9]);
  });
});

describe('toScoringAnswer', () => {
  const matchingItem = { type: 'matching' as const, content: matchingContent };

  it('cruza la sub-etiqueta del escaneo con el elemento respondible', () => {
    expect(toScoringAnswer(matchingItem, { B1: 'A.4', B3: 'A.2' })).toEqual({
      'B.1': 'A.4',
      'B.3': 'A.2',
    });
  });

  it('resuelve por posición cuando el escaneo numera sin rótulo (9.1 … 9.4)', () => {
    expect(toScoringAnswer(matchingItem, { '1': 'A.3', '2': 'A.1' })).toEqual({
      'B.1': 'A.3',
      'B.2': 'A.1',
    });
  });

  it('deja pasar el valor simple y trata el ítem ausente como sin responder', () => {
    expect(toScoringAnswer(matchingItem, 'A')).toBe('A');
    expect(toScoringAnswer(matchingItem, undefined)).toBeNull();
  });

  it('en un ítem no compuesto se queda con la primera sub-respuesta útil', () => {
    const item = { type: 'multiple_choice' as const, content: {} as ItemContent };
    expect(toScoringAnswer(item, { '1': '', '2': 'C' })).toBe('C');
  });
});
