import type { ItemContent, ItemType, ScoringConfig } from '@soe/types';
import { SCORING_STRATEGIES, getScoringStrategy, type ScoringInput } from './scoring-strategy';

// Helper para construir un ScoringInput con un maxScore por defecto de 1.
function input(
  type: ItemType,
  content: ItemContent,
  rawAnswer: unknown,
  maxScore = 1,
  scoringConfig?: ScoringConfig,
): ScoringInput {
  return { item: { id: 'item-1', type, content, maxScore, scoringConfig }, rawAnswer };
}

describe('SCORING_STRATEGIES (registro de estrategias por tipo)', () => {
  it('tiene una estrategia para cada ItemType', () => {
    const types: ItemType[] = [
      'multiple_choice',
      'multi_select',
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

  // ── multi_select ───────────────────────────────────────────────────────────
  // Forma real del ítem 29 de Ciencias 8° (impreso): 5 opciones, 3 correctas.
  // La hoja escanea el conjunto concatenado ("125").
  describe('multi_select', () => {
    const content = {
      stem: '¿Cuáles corresponden?',
      alternatives: [
        { key: '1', text: 'a', isCorrect: true },
        { key: '2', text: 'b', isCorrect: true },
        { key: '3', text: 'c', isCorrect: false },
        { key: '4', text: 'd', isCorrect: false },
        { key: '5', text: 'e', isCorrect: true },
      ],
    } as unknown as ItemContent;

    // Verificado contra el escaneo real: GradeCam dio 1 al conjunto exacto y 0 a
    // la respuesta parcial, con max_points 1. El default reproduce eso.
    it('conjunto exacto → correcto', () => {
      const out = getScoringStrategy('multi_select').score(input('multi_select', content, '125'));
      expect(out).toEqual({ isCorrect: true, rawScore: 1, requiresManualGrading: false });
    });

    it('el orden no importa', () => {
      expect(
        getScoringStrategy('multi_select').score(input('multi_select', content, '521')).isCorrect,
      ).toBe(true);
    });

    it('respuesta PARCIAL → 0 por defecto (todo o nada)', () => {
      const out = getScoringStrategy('multi_select').score(input('multi_select', content, '1'));
      expect(out).toEqual({ isCorrect: false, rawScore: 0, requiresManualGrading: false });
    });

    it('marcar de más → incorrecto', () => {
      expect(
        getScoringStrategy('multi_select').score(input('multi_select', content, '1253')).isCorrect,
      ).toBe(false);
    });

    it('sin responder → incorrecto, nunca pendiente', () => {
      const out = getScoringStrategy('multi_select').score(input('multi_select', content, null));
      expect(out).toEqual({ isCorrect: false, rawScore: 0, requiresManualGrading: false });
    });

    it('acepta separadores y arrays', () => {
      for (const raw of ['1,2,5', '1 2 5', ['1', '2', '5']]) {
        expect(
          getScoringStrategy('multi_select').score(input('multi_select', content, raw)).isCorrect,
        ).toBe(true);
      }
    });

    describe('crédito parcial (requireExact: false)', () => {
      const parcial: ScoringConfig = {
        points: 3,
        partialCredit: true,
        multiSelect: { requireExact: false },
      };

      it('2 de 3 correctas → 2 puntos', () => {
        const out = getScoringStrategy('multi_select').score(
          input('multi_select', content, '12', 3, parcial),
        );
        expect(out).toEqual({ isCorrect: false, rawScore: 2, requiresManualGrading: false });
      });

      it('todas correctas → maxScore e isCorrect true', () => {
        const out = getScoringStrategy('multi_select').score(
          input('multi_select', content, '125', 3, parcial),
        );
        expect(out).toEqual({ isCorrect: true, rawScore: 3, requiresManualGrading: false });
      });

      it('penaliza las marcadas de más, con piso en 0', () => {
        const config: ScoringConfig = {
          ...parcial,
          multiSelect: { requireExact: false, penaltyPerIncorrect: 1 },
        };
        const una = getScoringStrategy('multi_select').score(
          input('multi_select', content, '123', 3, config),
        );
        expect(una.rawScore).toBe(1);

        const todas = getScoringStrategy('multi_select').score(
          input('multi_select', content, '34', 3, config),
        );
        expect(todas.rawScore).toBe(0);
      });

      it('pointsPerCorrect explícito pondera cada acierto', () => {
        const out = getScoringStrategy('multi_select').score(
          input('multi_select', content, '12', 6, {
            ...parcial,
            points: 6,
            multiSelect: { requireExact: false, pointsPerCorrect: 2 },
          }),
        );
        expect(out.rawScore).toBe(4);
      });
    });

    it('respuesta ambigua (keys multi-carácter concatenadas) → 0, no adivina', () => {
      const multiChar = {
        stem: 'x',
        alternatives: [
          { key: 'A1', text: 'a', isCorrect: true },
          { key: 'B2', text: 'b', isCorrect: true },
          { key: 'C3', text: 'c', isCorrect: false },
        ],
      } as unknown as ItemContent;
      const out = getScoringStrategy('multi_select').score(
        input('multi_select', multiChar, 'A1B2'),
      );
      expect(out.rawScore).toBe(0);
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

    // ── Crédito parcial: la política de puntaje es configuración, no una
    // constante del tipo. `content4` reproduce la forma real de un ítem DIA:
    // 4 elementos respondibles contra un banco de 6 con 2 distractores.
    describe('crédito parcial', () => {
      const content4 = {
        leftItems: [
          { id: 'B.1', text: 'uno' },
          { id: 'B.2', text: 'dos' },
          { id: 'B.3', text: 'tres' },
          { id: 'B.4', text: 'cuatro' },
        ],
        rightItems: [
          { id: 'A.1', text: 'a' },
          { id: 'A.2', text: 'b' },
          { id: 'A.3', text: 'c' },
          { id: 'A.4', text: 'd' },
          { id: 'A.5', text: 'e' },
          { id: 'A.6', text: 'f' },
        ],
        correctPairs: [
          { leftId: 'B.1', rightId: 'A.3' },
          { leftId: 'B.2', rightId: 'A.1' },
          { leftId: 'B.3', rightId: 'A.2' },
          { leftId: 'B.4', rightId: 'A.6' },
        ],
      } as unknown as ItemContent;

      const partial: ScoringConfig = { points: 4, partialCredit: true };

      // Alumno real de 8A (ítem 7 de Ciencias 8°): acierta B.3 y B.4.
      it('2 de 4 correctos → rawScore 2, isCorrect false', () => {
        const out = getScoringStrategy('matching').score(
          input(
            'matching',
            content4,
            { 'B.1': 'A.4', 'B.2': 'A.5', 'B.3': 'A.2', 'B.4': 'A.6' },
            4,
            partial,
          ),
        );
        expect(out).toEqual({ isCorrect: false, rawScore: 2, requiresManualGrading: false });
      });

      it('todos correctos → rawScore = maxScore, isCorrect true', () => {
        const out = getScoringStrategy('matching').score(
          input(
            'matching',
            content4,
            { 'B.1': 'A.3', 'B.2': 'A.1', 'B.3': 'A.2', 'B.4': 'A.6' },
            4,
            partial,
          ),
        );
        expect(out).toEqual({ isCorrect: true, rawScore: 4, requiresManualGrading: false });
      });

      it('respuesta parcial (pares en blanco) puntúa los respondidos, no descarta el ítem', () => {
        const out = getScoringStrategy('matching').score(
          input('matching', content4, { 'B.1': 'A.3', 'B.3': 'A.2' }, 4, partial),
        );
        expect(out.rawScore).toBe(2);
      });

      it('sin pointsPerPair explícito lo deriva de maxScore / nº de pares', () => {
        const out = getScoringStrategy('matching').score(
          input('matching', content4, { 'B.1': 'A.3', 'B.2': 'A.1' }, 8, partial),
        );
        expect(out.rawScore).toBe(4);
      });

      it('pointsPerPair explícito pondera cada par', () => {
        const out = getScoringStrategy('matching').score(
          input('matching', content4, { 'B.1': 'A.3' }, 8, {
            ...partial,
            points: 8,
            matching: { pointsPerPair: 2 },
          }),
        );
        expect(out.rawScore).toBe(2);
      });

      it('penaliza los pares equivocados, pero nunca los dejados en blanco', () => {
        const config: ScoringConfig = {
          ...partial,
          matching: { penaltyPerIncorrectPair: 0.5 },
        };
        const conError = getScoringStrategy('matching').score(
          input('matching', content4, { 'B.1': 'A.3', 'B.2': 'A.9' }, 4, config),
        );
        expect(conError.rawScore).toBe(0.5);

        const enBlanco = getScoringStrategy('matching').score(
          input('matching', content4, { 'B.1': 'A.3' }, 4, config),
        );
        expect(enBlanco.rawScore).toBe(1);
      });

      it('la penalización no baja de 0', () => {
        const out = getScoringStrategy('matching').score(
          input('matching', content4, { 'B.1': 'A.9', 'B.2': 'A.9' }, 4, {
            ...partial,
            matching: { penaltyPerIncorrectPair: 3 },
          }),
        );
        expect(out.rawScore).toBe(0);
      });

      it('un rightId repetido (clasificación N → k) se corrige por elemento', () => {
        const clasificacion = {
          leftItems: [
            { id: 'i1', text: 'perro' },
            { id: 'i2', text: 'gato' },
            { id: 'i3', text: 'roble' },
          ],
          rightItems: [
            { id: 'animal', text: 'Animal' },
            { id: 'planta', text: 'Planta' },
          ],
          correctPairs: [
            { leftId: 'i1', rightId: 'animal' },
            { leftId: 'i2', rightId: 'animal' },
            { leftId: 'i3', rightId: 'planta' },
          ],
        } as unknown as ItemContent;

        const out = getScoringStrategy('matching').score(
          input('matching', clasificacion, { i1: 'animal', i2: 'planta', i3: 'planta' }, 3, {
            points: 3,
            partialCredit: true,
          }),
        );
        expect(out).toEqual({ isCorrect: false, rawScore: 2, requiresManualGrading: false });
      });

      it('columnas de distinto tamaño con distractores en el banco', () => {
        const out = getScoringStrategy('matching').score(
          input('matching', content4, { 'B.1': 'A.4', 'B.2': 'A.5' }, 4, partial),
        );
        expect(out.rawScore).toBe(0);
      });
    });

    it('sin correctPairs → incorrecto, nunca divide por cero', () => {
      const vacio = { leftItems: [], rightItems: [], correctPairs: [] } as unknown as ItemContent;
      const out = getScoringStrategy('matching').score(
        input('matching', vacio, { L1: 'R1' }, 4, { points: 4, partialCredit: true }),
      );
      expect(out).toEqual({ isCorrect: false, rawScore: 0, requiresManualGrading: false });
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
      const out = getScoringStrategy('ordering').score(input('ordering', content, ['A', 'B', 'C']));
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
      const out = getScoringStrategy('gap_fill').score(input('gap_fill', content, ['can', 'gato']));
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
