import type { ItemContent, ItemType } from '@soe/types';
import {
  SCORING_STRATEGIES,
  getScoringStrategy,
  type ScoringInput,
} from './scoring-strategy';

// Helper para construir un ScoringInput con un maxScore por defecto de 1.
function input(
  type: ItemType,
  content: ItemContent,
  rawAnswer: unknown,
  maxScore = 1,
): ScoringInput {
  return { item: { id: 'item-1', type, content, maxScore }, rawAnswer };
}

describe('SCORING_STRATEGIES (registro de estrategias por tipo)', () => {
  it('tiene una estrategia para cada ItemType', () => {
    const types: ItemType[] = [
      'multiple_choice',
      'true_false',
      'open_ended',
      'oral_reading',
      'oral_expression',
      'writing',
      'listening',
      'matching',
      'ordering',
      'gap_fill',
    ];
    for (const t of types) {
      expect(SCORING_STRATEGIES[t]).toBeDefined();
      expect(typeof getScoringStrategy(t).score).toBe('function');
    }
  });

  // ── multiple_choice ────────────────────────────────────────────────────────
  describe('multiple_choice', () => {
    const content = { stem: 'x', correctKey: 'B' } as unknown as ItemContent;

    it('respuesta correcta → isCorrect true, rawScore = maxScore', () => {
      const out = getScoringStrategy('multiple_choice').score(
        input('multiple_choice', content, 'B', 2),
      );
      expect(out).toEqual({ isCorrect: true, rawScore: 2, requiresManualGrading: false });
    });

    it('respuesta incorrecta → isCorrect false, rawScore 0', () => {
      const out = getScoringStrategy('multiple_choice').score(
        input('multiple_choice', content, 'A'),
      );
      expect(out).toEqual({ isCorrect: false, rawScore: 0, requiresManualGrading: false });
    });

    it('sin responder (null) → isCorrect false (NO pendiente)', () => {
      const out = getScoringStrategy('multiple_choice').score(
        input('multiple_choice', content, null),
      );
      expect(out).toEqual({ isCorrect: false, rawScore: 0, requiresManualGrading: false });
    });

    it('insensible a mayúsculas/espacios', () => {
      const out = getScoringStrategy('multiple_choice').score(
        input('multiple_choice', content, ' b '),
      );
      expect(out.isCorrect).toBe(true);
    });

    it('deriva la clave de alternatives[].isCorrect cuando no hay correctKey', () => {
      const altContent = {
        stem: 'x',
        alternatives: [
          { key: 'A', text: 'a', isCorrect: false },
          { key: 'C', text: 'c', isCorrect: true },
        ],
      } as unknown as ItemContent;
      const out = getScoringStrategy('multiple_choice').score(
        input('multiple_choice', altContent, 'C'),
      );
      expect(out.isCorrect).toBe(true);
    });
  });

  // ── true_false ─────────────────────────────────────────────────────────────
  describe('true_false', () => {
    const content = { stem: 'x', correctAnswer: true } as unknown as ItemContent;

    it('booleano correcto (V/TRUE) → correcto', () => {
      for (const ans of ['V', 'true', 'TRUE', 'Verdadero', 'A']) {
        const out = getScoringStrategy('true_false').score(input('true_false', content, ans));
        expect(out.isCorrect).toBe(true);
      }
    });

    it('respuesta falsa cuando la correcta es verdadera → incorrecto', () => {
      const out = getScoringStrategy('true_false').score(input('true_false', content, 'F'));
      expect(out).toEqual({ isCorrect: false, rawScore: 0, requiresManualGrading: false });
    });

    it('correctAnswer false acierta con F/FALSE', () => {
      const c = { stem: 'x', correctAnswer: false } as unknown as ItemContent;
      const out = getScoringStrategy('true_false').score(input('true_false', c, 'F'));
      expect(out.isCorrect).toBe(true);
    });
  });

  // ── matching ───────────────────────────────────────────────────────────────
  describe('matching', () => {
    const content = {
      leftItems: [
        { id: 'L1', text: 'a' },
        { id: 'L2', text: 'b' },
      ],
      rightItems: [
        { id: 'R1', text: '1' },
        { id: 'R2', text: '2' },
      ],
      correctPairs: [
        { leftId: 'L1', rightId: 'R2' },
        { leftId: 'L2', rightId: 'R1' },
      ],
    } as unknown as ItemContent;

    it('pares exactos (record) → correcto', () => {
      const out = getScoringStrategy('matching').score(
        input('matching', content, { L1: 'R2', L2: 'R1' }, 3),
      );
      expect(out).toEqual({ isCorrect: true, rawScore: 3, requiresManualGrading: false });
    });

    it('pares exactos (array) → correcto', () => {
      const out = getScoringStrategy('matching').score(
        input('matching', content, [
          { leftId: 'L1', rightId: 'R2' },
          { leftId: 'L2', rightId: 'R1' },
        ]),
      );
      expect(out.isCorrect).toBe(true);
    });

    it('un par mal → incorrecto (todo o nada)', () => {
      const out = getScoringStrategy('matching').score(
        input('matching', content, { L1: 'R1', L2: 'R2' }),
      );
      expect(out).toEqual({ isCorrect: false, rawScore: 0, requiresManualGrading: false });
    });

    it('sin responder → incorrecto (auto-scorable, no pendiente)', () => {
      const out = getScoringStrategy('matching').score(input('matching', content, null));
      expect(out.isCorrect).toBe(false);
      expect(out.requiresManualGrading).toBe(false);
    });
  });

  // ── ordering ───────────────────────────────────────────────────────────────
  describe('ordering', () => {
    const content = {
      items: [
        { id: 'A', text: 'a' },
        { id: 'B', text: 'b' },
        { id: 'C', text: 'c' },
      ],
      correctOrder: ['B', 'A', 'C'],
    } as unknown as ItemContent;

    it('orden exacto → correcto', () => {
      const out = getScoringStrategy('ordering').score(
        input('ordering', content, ['B', 'A', 'C'], 2),
      );
      expect(out).toEqual({ isCorrect: true, rawScore: 2, requiresManualGrading: false });
    });

    it('orden distinto → incorrecto', () => {
      const out = getScoringStrategy('ordering').score(
        input('ordering', content, ['A', 'B', 'C']),
      );
      expect(out.isCorrect).toBe(false);
    });

    it('acepta JSON string serializado', () => {
      const out = getScoringStrategy('ordering').score(
        input('ordering', content, JSON.stringify(['B', 'A', 'C'])),
      );
      expect(out.isCorrect).toBe(true);
    });
  });

  // ── gap_fill ───────────────────────────────────────────────────────────────
  describe('gap_fill', () => {
    const content = {
      textWithGaps: 'El ___ ladra y el ___ maúlla',
      gaps: [
        { position: 0, acceptedAnswers: ['perro', 'can'] },
        { position: 1, acceptedAnswers: ['gato'] },
      ],
    } as unknown as ItemContent;

    it('todos los gaps correctos (array) → correcto, insensible a mayúsculas', () => {
      const out = getScoringStrategy('gap_fill').score(
        input('gap_fill', content, ['Perro', 'GATO'], 2),
      );
      expect(out).toEqual({ isCorrect: true, rawScore: 2, requiresManualGrading: false });
    });

    it('acepta sinónimo declarado en acceptedAnswers', () => {
      const out = getScoringStrategy('gap_fill').score(
        input('gap_fill', content, ['can', 'gato']),
      );
      expect(out.isCorrect).toBe(true);
    });

    it('un gap mal → incorrecto', () => {
      const out = getScoringStrategy('gap_fill').score(
        input('gap_fill', content, ['perro', 'pez']),
      );
      expect(out.isCorrect).toBe(false);
    });

    it('respeta caseSensitive', () => {
      const cs = {
        textWithGaps: '___',
        gaps: [{ position: 0, acceptedAnswers: ['París'], caseSensitive: true }],
      } as unknown as ItemContent;
      expect(getScoringStrategy('gap_fill').score(input('gap_fill', cs, ['parís'])).isCorrect).toBe(
        false,
      );
      expect(getScoringStrategy('gap_fill').score(input('gap_fill', cs, ['París'])).isCorrect).toBe(
        true,
      );
    });

    it('acepta record por posición', () => {
      const out = getScoringStrategy('gap_fill').score(
        input('gap_fill', content, { '0': 'perro', '1': 'gato' }),
      );
      expect(out.isCorrect).toBe(true);
    });
  });

  // ── No auto-scorables → corrección manual ────────────────────────────────────
  describe('tipos no auto-scorables → requiresManualGrading', () => {
    const manualTypes: ItemType[] = [
      'open_ended',
      'writing',
      'oral_reading',
      'oral_expression',
      'listening',
    ];

    it.each(manualTypes)('%s → { isCorrect: null, rawScore: null, manual: true }', (type) => {
      const out = getScoringStrategy(type).score(
        input(type, { prompt: 'x' } as unknown as ItemContent, 'cualquier cosa'),
      );
      expect(out).toEqual({
        isCorrect: null,
        rawScore: null,
        requiresManualGrading: true,
      });
    });
  });

  // ── GOLDEN TEST: regresión DIA/MCQ ───────────────────────────────────────────
  // Replica EXACTAMENTE la lógica previa de answer-sheets.service.ts y verifica
  // que la nueva estrategia MCQ produce el mismo isCorrect/rawScore para todos los
  // casos de un set de respuestas tipo DIA. CERO REGRESIÓN.
  describe('GOLDEN: regresión MCQ vs lógica previa', () => {
    function legacyScore(rawAnswer: string | null, correctKey: string, maxScore: number) {
      const isCorrect =
        rawAnswer === null ? false : rawAnswer.toUpperCase() === correctKey.toUpperCase();
      return { isCorrect, rawScore: isCorrect ? maxScore : 0 };
    }

    const correctKey = 'B';
    const maxScore = 1;
    const content = { stem: 'x', correctKey } as unknown as ItemContent;
    // Valores tal como llegan al loop tras `normalizeAnswerValue` del parser
    // (ya trim + uppercase; vacíos → null). Es el dominio real del flujo DIA.
    const rawAnswers: Array<string | null> = ['A', 'B', 'C', 'D', null];

    it('coincide con la lógica legacy en todos los casos', () => {
      for (const raw of rawAnswers) {
        const legacy = legacyScore(raw, correctKey, maxScore);
        const out = getScoringStrategy('multiple_choice').score(
          input('multiple_choice', content, raw, maxScore),
        );
        expect(out.isCorrect).toBe(legacy.isCorrect);
        expect(out.rawScore).toBe(legacy.rawScore);
        expect(out.requiresManualGrading).toBe(false);
      }
    });
  });
});
