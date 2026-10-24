import {
  getScoringStrategy,
  type CanonicalValue,
  type ItemContent,
  type NormalizedAnswer,
  type ResponseFormat,
  type ScoringOutcome,
  type TranscriptionOutput,
} from '@soe/types';
import { fakeOutput } from '../fake/fake-transcriber';
import {
  isSupportedFormat,
  normalizeTranscription,
  outputPartsSchemaFor,
  toScoringInput,
} from '../formats/registry';
import { toScoringOutcome } from '../consensus/scoring-outcome';
import type { ScoreOf } from '../consensus/evaluate-consensus';
import type { EvalSample } from './manifest';

/** Etiqueta normalizada con el mismo registro de formatos que usa producción. */
export interface LabelTruth {
  readonly state: EvalSample['label']['state'];
  readonly literal: string;
  readonly canonical: string | null;
  readonly normalized: NormalizedAnswer | null;
}

export function labelTruth(sample: EvalSample): LabelTruth {
  const { state, literal } = sample.label;
  if (state !== 'answered' || !isSupportedFormat(sample.format)) {
    return { state, literal, canonical: sample.label.canonical ?? null, normalized: null };
  }
  const normalized = normalizeTranscription(fakeOutput(literal), sample.format);
  return {
    state,
    literal,
    canonical: sample.label.canonical ?? normalized.canonical,
    normalized,
  };
}

function scalarText(value: CanonicalValue): string {
  if (value.type === 'number') return value.written;
  if (value.type === 'fraction') return `${value.written.numerator}/${value.written.denominator}`;
  return '';
}

function partsFromValue(value: CanonicalValue | null): Record<string, string> {
  if (value === null) return {};
  if (value.type === 'fraction') {
    return {
      whole: value.written.whole ?? '',
      numerator: value.written.numerator,
      denominator: value.written.denominator,
    };
  }
  if (value.type === 'tuple') {
    return Object.fromEntries(
      value.components.map((component, index) => [`c${index + 1}`, scalarText(component)]),
    );
  }
  if (value.type === 'sequence') {
    return Object.fromEntries(value.elements.map((element, index) => [`e${index + 1}`, element]));
  }
  return {};
}

/**
 * Salida de lector "perfecta" para una muestra: la que devolvería un lector que
 * lee exactamente la etiqueta. La usa `--dry-run` con el transcriptor falso.
 */
export function labelAsOutput(sample: EvalSample): TranscriptionOutput {
  const { state, literal } = sample.label;
  const schema = outputPartsSchemaFor(sample.format);
  if (state !== 'answered') {
    const emptyParts =
      schema === null ? null : Object.fromEntries(schema.required.map((id) => [id, '']));
    return fakeOutput('', { state, parts: emptyParts, characters: [] });
  }
  if (schema === null) return fakeOutput(literal);
  const fromValue = partsFromValue(labelTruth(sample).normalized?.value ?? null);
  const parts = Object.fromEntries(schema.required.map((id) => [id, fromValue[id] ?? '']));
  return fakeOutput(literal, { parts });
}

/**
 * Corrector de la muestra. Con `acceptedAnswers` usa la estrategia de producción
 * (`short_answer`). Sin clave usa la etiqueta como clave implícita: así el paso
 * "alternativa que cambia el resultado" se comporta como con una clave real que
 * coincide con lo escrito (el caso más exigente).
 */
export function sampleScorer(sample: EvalSample, truth: LabelTruth): ScoreOf {
  const accepted = sample.acceptedAnswers;
  if (accepted && accepted.length > 0) {
    const content = {
      prompt: sample.id,
      acceptedAnswers: accepted,
      responseFormat: sample.format,
    } as ItemContent;
    return (answer) =>
      toScoringOutcome(
        getScoringStrategy('short_answer').score({
          item: {
            id: sample.id,
            type: 'short_answer',
            content,
            maxScore: sample.scoringConfig?.points ?? 1,
            ...(sample.scoringConfig ? { scoringConfig: sample.scoringConfig } : {}),
          },
          rawAnswer: toScoringInput(answer),
        }),
      );
  }
  return (answer): ScoringOutcome =>
    answer.canonical !== null && answer.canonical === truth.canonical ? 'correct' : 'incorrect';
}

/** Resultado de corrección que corresponde a la etiqueta (solo con `acceptedAnswers`). */
export function expectedScoringOutcome(
  sample: EvalSample,
  truth: LabelTruth,
  scoreOf: ScoreOf,
): ScoringOutcome | null {
  if (!sample.acceptedAnswers || sample.acceptedAnswers.length === 0) return null;
  if (truth.state === 'blank') {
    return scoreOf({
      formatKind: sample.format.kind,
      state: 'blank',
      canonical: null,
      value: null,
      issues: [],
    });
  }
  if (truth.normalized === null || truth.normalized.canonical === null) return null;
  return scoreOf(truth.normalized);
}

export function isEvaluableFormat(format: ResponseFormat): boolean {
  return isSupportedFormat(format);
}
