import type { ItemContent } from '@soe/types';
import { isUnexpectedCompositeAnswer, resolveCompositeAnswer } from './composite-answers';
import { assignAnswer, parseQuestionColumn } from './parsers/parser.types';
import type { ParsedAnswerValue } from './parsers/parser.types';

describe('parseQuestionColumn', () => {
  it('separa la posición de la sub-etiqueta', () => {
    expect(parseQuestionColumn('Q12')).toEqual({ position: '12', subKey: null });
    expect(parseQuestionColumn('7B1')).toEqual({ position: '7', subKey: 'B1' });
    expect(parseQuestionColumn('9.1')).toEqual({ position: '9', subKey: '1' });
    expect(parseQuestionColumn('19.5')).toEqual({ position: '19', subKey: '5' });
    expect(parseQuestionColumn('Q01')).toEqual({ position: '1', subKey: null });
  });

  it('descarta columnas sin dígitos o con posición 0', () => {
    expect(parseQuestionColumn('Nombre')).toBeNull();
    expect(parseQuestionColumn('Q0')).toBeNull();
  });
});

describe('assignAnswer', () => {
  it('agrupa las sub-columnas de un mismo ítem en vez de pisarlas', () => {
    const answers: Record<string, ParsedAnswerValue> = {};
    assignAnswer(answers, '7B1', 'A.4');
    assignAnswer(answers, '7B2', 'A.5');
    assignAnswer(answers, '7B3', 'A.2');
    assignAnswer(answers, '7B4', 'A.6');
    expect(answers['7']).toEqual({ B1: 'A.4', B2: 'A.5', B3: 'A.2', B4: 'A.6' });
  });

  it('no altera el caso simple de una columna por pregunta', () => {
    const answers: Record<string, ParsedAnswerValue> = {};
    assignAnswer(answers, 'Q1', 'b');
    assignAnswer(answers, 'Q2', '');
    expect(answers).toEqual({ '1': 'B', '2': null });
  });
});

describe('resolveCompositeAnswer', () => {
  // Forma real del ítem 7 de Ciencias 8°: se responde la columna B contra un
  // banco A con distractores.
  const matching = {
    type: 'matching' as const,
    content: {
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
    } as unknown as ItemContent,
  };

  it('cruza la sub-etiqueta del escaneo con el elemento respondible', () => {
    const out = resolveCompositeAnswer(matching, {
      B1: 'A.4',
      B2: 'A.5',
      B3: 'A.2',
      B4: 'A.6',
    });
    expect(out).toEqual({ 'B.1': 'A.4', 'B.2': 'A.5', 'B.3': 'A.2', 'B.4': 'A.6' });
  });

  it('resuelve por posición cuando el escaneo numera sin rótulo (9.1 … 9.4)', () => {
    const out = resolveCompositeAnswer(matching, { '1': 'A.3', '2': 'A.1' });
    expect(out).toEqual({ 'B.1': 'A.3', 'B.2': 'A.1' });
  });

  it('deja pasar el valor simple sin tocarlo', () => {
    expect(resolveCompositeAnswer(matching, 'A')).toBe('A');
    expect(resolveCompositeAnswer(matching, null)).toBeNull();
  });

  it('en un ítem no compuesto se queda con la primera sub-respuesta útil', () => {
    const mcq = { type: 'multiple_choice' as const, content: {} as ItemContent };
    expect(resolveCompositeAnswer(mcq, { '1': '', '2': 'C' })).toBe('C');
  });
});

describe('isUnexpectedCompositeAnswer', () => {
  it('marca la sub-numeración de un ítem que no es compuesto', () => {
    expect(isUnexpectedCompositeAnswer({ type: 'open_ended' }, { '1': 'a' })).toBe(true);
    expect(isUnexpectedCompositeAnswer({ type: 'matching' }, { B1: 'A.1' })).toBe(false);
    expect(isUnexpectedCompositeAnswer({ type: 'multiple_choice' }, 'A')).toBe(false);
  });
});
