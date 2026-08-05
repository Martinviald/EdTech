import type { ItemContent } from '../schemas/item-content.schema';
import { maxScoreOf, scoreAnswerSheetCell, type AnswerSheetItem } from './answer-sheet';

function item(
  type: AnswerSheetItem['type'],
  content: unknown,
  scoringConfig?: unknown,
): AnswerSheetItem {
  return {
    id: 'i1',
    type,
    content: content as ItemContent,
    scoringConfig: scoringConfig as AnswerSheetItem['scoringConfig'],
  };
}

describe('maxScoreOf', () => {
  it('sale de scoring_config.points', () => {
    expect(maxScoreOf({ scoringConfig: { points: 4 } as never })).toBe(4);
  });

  it('sin points declarado, vale 1', () => {
    expect(maxScoreOf({ scoringConfig: null })).toBe(1);
    expect(maxScoreOf({ scoringConfig: {} as never })).toBe(1);
  });
});

describe('scoreAnswerSheetCell', () => {
  const mcq = item('multiple_choice', { stem: 'x', correctKey: 'B' });

  it('una celda vacía o con espacios es "no respondió"', () => {
    for (const cell of [null, '', '   ']) {
      expect(scoreAnswerSheetCell(mcq, cell)).toEqual({
        isCorrect: false,
        rawScore: 0,
        requiresManualGrading: false,
      });
    }
  });

  it('recorta la celda antes de comparar', () => {
    expect(scoreAnswerSheetCell(mcq, '  b  ').isCorrect).toBe(true);
  });

  describe('matching: la hoja trae una secuencia posicional', () => {
    const content = {
      prompt: 'Une',
      leftItems: [{ id: 'B.1' }, { id: 'B.2' }, { id: 'B.3' }, { id: 'B.4' }],
      rightItems: [{ id: 'A.1' }, { id: 'A.2' }, { id: 'A.3' }, { id: 'A.4' }, { id: 'A.5' }],
      correctPairs: [
        { leftId: 'B.1', rightId: 'A.2' },
        { leftId: 'B.2', rightId: 'A.5' },
        { leftId: 'B.3', rightId: 'A.3' },
        { leftId: 'B.4', rightId: 'A.4' },
      ],
    };

    it('todo correcto con crédito parcial da el máximo', () => {
      const out = scoreAnswerSheetCell(
        item('matching', content, { points: 4, partialCredit: true }),
        '2,5,3,4',
      );
      expect(out).toEqual({ isCorrect: true, rawScore: 4, requiresManualGrading: false });
    });

    it('tres de cuatro pares dan tres puntos, no cero', () => {
      const out = scoreAnswerSheetCell(
        item('matching', content, { points: 4, partialCredit: true }),
        '2,5,3,1',
      );
      expect(out.rawScore).toBe(3);
      expect(out.isCorrect).toBe(false);
    });

    it('sin crédito parcial declarado sigue siendo todo o nada', () => {
      const out = scoreAnswerSheetCell(item('matching', content, { points: 4 }), '2,5,3,1');
      expect(out.rawScore).toBe(0);
    });
  });

  it('rubric_scored convierte el código en puntaje y tolera el cero a la izquierda', () => {
    const rubric = item(
      'rubric_scored',
      {
        prompt: 'x',
        levels: [
          { code: '0', creditFraction: 0 },
          { code: '1', creditFraction: 0.5 },
          { code: '2', creditFraction: 1 },
        ],
      },
      { points: 1 },
    );
    expect(scoreAnswerSheetCell(rubric, '1').rawScore).toBe(0.5);
    expect(scoreAnswerSheetCell(rubric, '01')).toEqual(scoreAnswerSheetCell(rubric, '1'));
    expect(scoreAnswerSheetCell(rubric, '12').requiresManualGrading).toBe(true);
  });

  it('short_answer acepta la misma cantidad escrita distinto', () => {
    const short = item('short_answer', {
      prompt: 'Resuelve 0,25 • 10 =',
      acceptedAnswers: ['2,5'],
      comparison: 'numeric',
    });
    for (const cell of ['2,5', '2.5', '2.50', '02,50']) {
      expect(scoreAnswerSheetCell(short, cell).isCorrect).toBe(true);
    }
    expect(scoreAnswerSheetCell(short, '250').isCorrect).toBe(false);
    expect(scoreAnswerSheetCell(short, '5x5=25').requiresManualGrading).toBe(true);
  });
});
