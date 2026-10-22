import {
  getScoringStrategy,
  type ItemContent,
  type ItemType,
  type ScoringConfig,
} from '@soe/types';
import { buildPrintedLabelIndex, resolveRowAnswers, toScoringAnswer } from '../composite-answers';

export interface TruthTableItem {
  name: string;
  type: ItemType;
  content: ItemContent;
  maxScore: number;
  scoringConfig?: ScoringConfig;
  answers: (string | null)[];
}

export interface TruthTableOutcome {
  isCorrect: boolean | null;
  rawScore: number | null;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function letterAnswers(keys: readonly string[]): (string | null)[] {
  const answers: (string | null)[] = [null, ''];
  for (const key of keys) {
    answers.push(key, key.toLowerCase(), ` ${key} `);
  }
  for (const [index, key] of keys.entries()) {
    const next = keys[(index + 1) % keys.length];
    if (next !== undefined && next !== key) answers.push(`${key}${next}`, `${key},${next}`);
  }
  answers.push('Z', '?');
  return answers;
}

function subsetsOf(keys: readonly string[]): string[][] {
  const subsets: string[][] = [];
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    subsets.push(keys.filter((_, bit) => (mask & (1 << bit)) !== 0));
  }
  return subsets;
}

function multipleChoiceItems(): TruthTableItem[] {
  const items: TruthTableItem[] = [];
  for (let optionCount = 2; optionCount <= 6; optionCount++) {
    const keys = LETTERS.slice(0, optionCount);
    for (const correct of keys) {
      for (const maxScore of [0, 1, 2]) {
        items.push({
          name: `mc-${optionCount}-alternativas-isCorrect-${correct}-max${maxScore}`,
          type: 'multiple_choice',
          content: {
            stem: 'x',
            alternatives: keys.map((key) => ({ key, text: key, isCorrect: key === correct })),
          } as ItemContent,
          maxScore,
          answers: letterAnswers(keys),
        });
      }
      items.push({
        name: `mc-${optionCount}-correctKey-${correct}`,
        type: 'multiple_choice',
        content: {
          stem: 'x',
          correctKey: correct,
          alternatives: keys.map((key) => ({ key, text: key, isCorrect: false })),
        } as ItemContent,
        maxScore: 1,
        answers: letterAnswers(keys),
      });
      items.push({
        name: `mc-${optionCount}-claves-minuscula-${correct}`,
        type: 'multiple_choice',
        content: {
          stem: 'x',
          alternatives: keys.map((key) => ({
            key: key.toLowerCase(),
            text: key,
            isCorrect: key === correct,
          })),
        } as ItemContent,
        maxScore: 1,
        answers: letterAnswers(keys),
      });
    }
    const numericKeys = keys.map((_, index) => String(index + 1));
    items.push({
      name: `mc-${optionCount}-claves-numericas`,
      type: 'multiple_choice',
      content: {
        stem: 'x',
        alternatives: numericKeys.map((key, index) => ({ key, text: key, isCorrect: index === 0 })),
      } as ItemContent,
      maxScore: 1,
      answers: letterAnswers(numericKeys),
    });
  }
  return items;
}

function trueFalseItems(): TruthTableItem[] {
  const answers = [null, '', 'V', 'F', 'v', 'f', 'VF', 'Verdadero', 'Falso', 'A', 'B'];
  const items: TruthTableItem[] = [];
  for (const correctAnswer of [true, false]) {
    items.push({
      name: `vf-booleano-${correctAnswer}`,
      type: 'true_false',
      content: { stem: 'x', correctAnswer } as ItemContent,
      maxScore: 1,
      answers,
    });
    items.push({
      name: `vf-como-alternativas-${correctAnswer}`,
      type: 'multiple_choice',
      content: {
        stem: 'x',
        alternatives: [
          { key: 'V', text: 'Verdadero', isCorrect: correctAnswer },
          { key: 'F', text: 'Falso', isCorrect: !correctAnswer },
        ],
      } as ItemContent,
      maxScore: 1,
      answers,
    });
  }
  return items;
}

function multiSelectItems(): TruthTableItem[] {
  const items: TruthTableItem[] = [];
  const policies: { name: string; scoringConfig?: ScoringConfig }[] = [
    { name: 'exacta' },
    {
      name: 'parcial',
      scoringConfig: { points: 2, multiSelect: { requireExact: false } } as ScoringConfig,
    },
    {
      name: 'parcial-con-penalizacion',
      scoringConfig: {
        points: 2,
        multiSelect: { requireExact: false, penaltyPerIncorrect: 0.5 },
      } as ScoringConfig,
    },
    {
      name: 'puntos-por-correcta',
      scoringConfig: {
        points: 2,
        multiSelect: { requireExact: false, pointsPerCorrect: 1 },
      } as ScoringConfig,
    },
  ];
  for (let optionCount = 3; optionCount <= 5; optionCount++) {
    const keys = LETTERS.slice(0, optionCount);
    const answers: (string | null)[] = [null];
    for (const subset of subsetsOf(keys)) {
      answers.push(subset.join(''), subset.join(','));
    }
    for (const correct of [keys.slice(0, 2), [keys[0]!, keys[optionCount - 1]!], keys.slice(1)]) {
      for (const policy of policies) {
        items.push({
          name: `ms-${optionCount}-correctas-${correct.join('')}-${policy.name}`,
          type: 'multi_select',
          content: {
            stem: 'x',
            alternatives: keys.map((key) => ({ key, text: key, isCorrect: correct.includes(key) })),
          } as ItemContent,
          maxScore: policy.scoringConfig ? 2 : 1,
          ...(policy.scoringConfig ? { scoringConfig: policy.scoringConfig } : {}),
          answers,
        });
      }
    }
  }
  return items;
}

function withDistinctAnswers(item: TruthTableItem): TruthTableItem {
  return { ...item, answers: [...new Set(item.answers)] };
}

export function alternativesTruthTable(): TruthTableItem[] {
  return [...multipleChoiceItems(), ...trueFalseItems(), ...multiSelectItems()].map(
    withDistinctAnswers,
  );
}

export function caseKey(item: TruthTableItem, answer: string | null): string {
  return `${item.name}|${answer === null ? '<null>' : JSON.stringify(answer)}`;
}

export function scoreScannedAnswer(item: TruthTableItem, answer: string | null): TruthTableOutcome {
  const resolvable = { id: item.name, position: 1, type: item.type, content: item.content };
  const index = buildPrintedLabelIndex([resolvable]);
  const resolved = resolveRowAnswers(index, { '1': answer });
  const rawAnswer = toScoringAnswer(resolvable, resolved.byPosition.get(1));
  const result = getScoringStrategy(item.type).score({
    item: {
      id: item.name,
      type: item.type,
      content: item.content,
      maxScore: item.maxScore,
      ...(item.scoringConfig ? { scoringConfig: item.scoringConfig } : {}),
    },
    rawAnswer,
  });
  return { isCorrect: result.isCorrect, rawScore: result.rawScore };
}
