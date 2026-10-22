import type { ItemContent } from '@soe/types';
import { toScoringAnswer } from './composite-answers';
import {
  alternativesTruthTable,
  caseKey,
  scoreScannedAnswer,
  type TruthTableOutcome,
} from './testing/alternatives-truth-table';
import baseSnapshot from './testing/alternatives-truth-table.snapshot.json';

function decodeOutcome(code: string): TruthTableOutcome {
  const [correct, score] = code.split(':');
  return {
    isCorrect: correct === '?' ? null : correct === '1',
    rawScore: score === 'null' ? null : Number(score),
  };
}

function snapshotOutcomes(): Map<string, TruthTableOutcome> {
  const outcomes = new Map<string, TruthTableOutcome>();
  const encoded: Record<string, string> = baseSnapshot.outcomes;
  for (const item of alternativesTruthTable()) {
    const codes = (encoded[item.name] ?? '').split(' ').filter((code) => code.length > 0);
    for (const [index, answer] of item.answers.entries()) {
      const code = codes[index];
      if (code !== undefined) outcomes.set(caseKey(item, answer), decodeOutcome(code));
    }
  }
  return outcomes;
}

describe('corrección de alternativas escaneadas contra la base previa a la visión (3d99adde)', () => {
  const items = alternativesTruthTable();
  const snapshot = snapshotOutcomes();

  it('la tabla de verdad cubre exactamente los casos del snapshot', () => {
    const cases = items.reduce((total, item) => total + item.answers.length, 0);
    expect(cases).toBe(baseSnapshot.cases);
    expect(snapshot.size).toBe(baseSnapshot.cases);
  });

  it('ninguna respuesta correcta en la base pasa a incorrecta y ningún puntaje baja', () => {
    const regressions: string[] = [];
    for (const item of items) {
      for (const answer of item.answers) {
        const key = caseKey(item, answer);
        const before = snapshot.get(key);
        const now = scoreScannedAnswer(item, answer);
        if (!before) {
          regressions.push(`${key}: sin snapshot`);
          continue;
        }
        if (before.isCorrect === true && now.isCorrect !== true) {
          regressions.push(`${key}: correcta → ${String(now.isCorrect)}`);
        }
        if ((now.rawScore ?? 0) < (before.rawScore ?? 0)) {
          regressions.push(`${key}: puntaje ${before.rawScore} → ${now.rawScore}`);
        }
      }
    }
    expect(regressions).toEqual([]);
  });

  it('las alternativas nunca quedan pendientes de corrección manual', () => {
    const pending = items.flatMap((item) =>
      item.answers
        .filter((answer) => scoreScannedAnswer(item, answer).isCorrect === null)
        .map((answer) => caseKey(item, answer)),
    );
    expect(pending).toEqual([]);
  });
});

describe('pareados: un valor que ya es el id de una opción se conserva', () => {
  const leftItems = [
    { id: 'L1', label: '1', text: 'uno' },
    { id: 'L2', label: '2', text: 'dos' },
    { id: 'L3', label: '3', text: 'tres' },
  ];
  const rightIdSchemes: Record<string, string[]> = {
    letras: ['A', 'B', 'C', 'D'],
    minusculas: ['a', 'b', 'c', 'd'],
    largos: ['opcion-uno', 'opcion-dos', 'opcion-tres', 'opcion-cuatro'],
    uuid: [
      '0a0a0a0a-0000-4000-8000-000000000001',
      '0a0a0a0a-0000-4000-8000-000000000002',
      '0a0a0a0a-0000-4000-8000-000000000003',
      '0a0a0a0a-0000-4000-8000-000000000004',
    ],
    'letra-cruzada': ['B', 'A', 'D', 'C'],
  };
  const labelSchemes: Record<string, (index: number) => string | undefined> = {
    'sin-rotulo': () => undefined,
    'rotulo-letra': (index) => ['A', 'B', 'C', 'D'][index],
    'rotulo-letra-invertida': (index) => ['D', 'C', 'B', 'A'][index],
    'rotulo-numero': (index) => String(index + 1),
    'rotulo-largo': (index) => `Opción ${index + 1}`,
  };

  const combinations = Object.entries(rightIdSchemes).flatMap(([idName, ids]) =>
    Object.entries(labelSchemes).map(([labelName, labelOf]) => ({
      idName,
      labelName,
      ids,
      labelOf,
    })),
  );

  it.each(combinations)('ids $idName con $labelName', ({ ids, labelOf }) => {
    const rightItems = ids.map((id, index) => {
      const label = labelOf(index);
      return label === undefined ? { id, text: `texto ${id}` } : { id, label, text: `texto ${id}` };
    });
    const correctPairs = [{ leftId: 'L1', rightId: ids[0]! }];
    const content = { leftItems, rightItems, correctPairs } as ItemContent;

    for (const id of ids) {
      const answer = toScoringAnswer({ type: 'matching', content }, { '1': id, '2': ` ${id} ` });
      expect(answer).toEqual({ L1: id, L2: id });
    }
  });
});
