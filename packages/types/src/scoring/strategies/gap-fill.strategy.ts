// Estrategia determinística para `gap_fill`. Cada gap tiene `acceptedAnswers`
// (lista de respuestas válidas) y un flag opcional `caseSensitive`.
//
// Por defecto la corrección es "todo o nada" y exacta: el alumno acierta el ítem
// solo si TODOS los gaps calzan con una clave (sin mayúsculas ni espacios en los
// bordes). Dos extensiones, ambas opcionales (diseño §10.1):
//   · comparación por casilla: si la casilla declara `comparison`, o si el ítem
//     declara el formato `multi_box` (el tipo de la casilla decide: número o
//     fracción → numérica; texto → texto corto), se compara como `short_answer`.
//     Una casilla indecidible deja el ítem pendiente, salvo que otra casilla ya
//     lo haga incorrecto en todo o nada;
//   · crédito por casilla: `scoring_config.componentCredit` (peso por casilla) o
//     `partialCredit: true` (pesos iguales). `partialCredit: false` lo apaga.
//
// La respuesta del alumno puede venir como:
//   - array ordenado por posición de gap: ["casa", "perro"]
//   - record por casilla: { "decenas": "3" }, o por posición: { "0": "casa" }

import type { GapFillContent } from '../../schemas/item-content.schema';
import type { ResponseFormat } from '../../schemas/answer-reading/response-format.schema';
import {
  creditForAcceptedAnswer,
  type ShortAnswerComparison,
  type ShortAnswerCredit,
} from '../../utils/short-answer';
import type { ScoringInput, ScoringOutput, ScoringStrategy } from '../scoring-strategy';
import { asRecord, asStringArray, normalizeAnswer } from './scoring.helpers';

type Gap = GapFillContent['gaps'][number];
type MultiBoxFormat = Extract<ResponseFormat, { kind: 'multi_box' }>;
type BoxKind = MultiBoxFormat['boxes'][number]['kind'];

/** Identificador de la casilla: el declarado o la posición como texto. */
function gapPartId(gap: Pick<Gap, 'partId' | 'position'>): string {
  return gap.partId ?? String(gap.position);
}

/** Devuelve la respuesta del alumno para el gap, o null. */
function answerForGap(raw: unknown, gap: Gap, index: number): string | null {
  const arr = asStringArray(raw);
  if (arr) return arr[index] ?? null;
  const record = asRecord(raw);
  if (record) {
    for (const key of [gapPartId(gap), String(gap.position), String(index)]) {
      const value = record[key];
      if (typeof value === 'string') return value;
    }
  }
  return null;
}

function comparisonFor(gap: Gap, boxKind: BoxKind | undefined): ShortAnswerComparison | null {
  if (gap.comparison) return gap.comparison;
  if (boxKind === undefined) return null;
  return boxKind === 'short_text' ? 'short_text' : 'numeric';
}

const CORRECT: ShortAnswerCredit = { outcome: 'correct', credit: 1 };
const INCORRECT: ShortAnswerCredit = { outcome: 'incorrect', credit: 0 };

function scoreGap(
  input: ScoringInput,
  gap: Gap,
  index: number,
  boxKind: BoxKind | undefined,
): ShortAnswerCredit {
  const answer = answerForGap(input.rawAnswer, gap, index);
  if (answer === null || answer.trim().length === 0) return INCORRECT;
  const comparison = comparisonFor(gap, boxKind);
  const caseSensitive = gap.caseSensitive === true;
  if (comparison === null) {
    const normalizedStudent = normalizeAnswer(answer, caseSensitive);
    return gap.acceptedAnswers.some(
      (accepted) => normalizeAnswer(accepted, caseSensitive) === normalizedStudent,
    )
      ? CORRECT
      : INCORRECT;
  }
  return creditForAcceptedAnswer(answer, gap.acceptedAnswers, {
    comparison,
    caseSensitive,
    formatKind: boxKind,
    equivalences: input.item.scoringConfig?.equivalences,
  });
}

function creditWeights(input: ScoringInput, gapCount: number): readonly number[] | null {
  const config = input.item.scoringConfig;
  if (config?.partialCredit === false) return null;
  if (config?.componentCredit) return config.componentCredit.creditPerComponent;
  if (config?.partialCredit === true) return Array.from({ length: gapCount }, () => 1 / gapCount);
  return null;
}

export const gapFillStrategy: ScoringStrategy = {
  score(input: ScoringInput): ScoringOutput {
    const content = input.item.content as GapFillContent;
    const gaps = content.gaps ?? [];
    const maxScore = input.item.maxScore;

    const incorrect: ScoringOutput = {
      isCorrect: false,
      rawScore: 0,
      requiresManualGrading: false,
    };
    const pending: ScoringOutput = { isCorrect: null, rawScore: null, requiresManualGrading: true };

    if (gaps.length === 0) return incorrect;

    const format = content.responseFormat?.kind === 'multi_box' ? content.responseFormat : null;
    const boxKinds = new Map(format?.boxes.map((box) => [box.partId, box.kind]) ?? []);
    const results = gaps.map((gap, index) =>
      scoreGap(input, gap, index, boxKinds.get(gapPartId(gap))),
    );

    if (results.every((result) => result.outcome === 'correct')) {
      return { isCorrect: true, rawScore: maxScore, requiresManualGrading: false };
    }

    const weights = creditWeights(input, gaps.length);
    const undecided = results.some((result) => result.outcome === 'undecidable');
    if (weights === null) {
      const settled = results.some(
        (result) => result.outcome === 'incorrect' || result.outcome === 'partial',
      );
      return settled || !undecided ? incorrect : pending;
    }
    if (undecided) return pending;

    let credit = 0;
    results.forEach((result, index) => {
      credit += result.credit * (weights[index] ?? 0);
    });
    return {
      isCorrect: false,
      rawScore: maxScore * Math.min(credit, 1),
      requiresManualGrading: false,
    };
  },
};
