/**
 * Traducción entre los contratos del paquete y el SDK de TypeSafe (Jev).
 * La respuesta del SDK no viene validada (es el JSON crudo): se trata como
 * `unknown` y se valida campo a campo.
 */

import {
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
  type ChoiceCriteria,
  type Question as SdkQuestion,
  type Questions as SdkQuestions,
  type ScoreCriteria,
} from '@typesafe-ai/sdk';

import {
  DecisionError,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type DecisionAnswer,
  type DecisionAnswers,
  type DecisionQuestion,
  type DecisionQuestions,
  type DecisionUsage,
  type NoulAnswer,
  type ScoreAnswer,
  type ScoreQuestion,
} from '../contracts';
import { assertAnswerMatches, isPlainObject, toTypedAnswers } from '../questions';

/** Status no estándar de Jev para "sobrecargado"; se trata como rate limit. */
export const JEV_OVERLOADED_STATUS = 529;

// ── Request ──────────────────────────────────────────────────────────────────

export function toSdkQuestions(questions: DecisionQuestions): SdkQuestions {
  const out: SdkQuestions = {};
  for (const [id, question] of Object.entries(questions)) {
    out[id] = toSdkQuestion(id, question);
  }
  return out;
}

function toSdkQuestion(id: string, question: DecisionQuestion): SdkQuestion {
  switch (question.type) {
    case 'noul':
      return question.criteria === undefined
        ? { type: 'noul', instructions: question.instructions }
        : { type: 'noul', instructions: question.instructions, criteria: { ...question.criteria } };
    case 'choice': {
      const criteria: ChoiceCriteria = { ...question.criteria };
      return { type: 'choice', instructions: question.instructions, criteria };
    }
    case 'score': {
      const [first, second, ...rest] = question.criteria;
      if (first === undefined || second === undefined) {
        throw new DecisionError(
          'invalid_request',
          `La pregunta "${id}" (score) requiere al menos 2 niveles.`,
        );
      }
      const criteria: ScoreCriteria = [first, second, ...rest];
      return { type: 'score', instructions: question.instructions, criteria };
    }
  }
}

// ── Response ─────────────────────────────────────────────────────────────────

export interface ParsedSystemOneResponse<Q extends DecisionQuestions> {
  readonly answers: DecisionAnswers<Q>;
  readonly model: string;
  readonly usage: DecisionUsage;
}

/**
 * Valida la respuesta cruda de `POST /v1/systemone` contra las preguntas pedidas.
 * Falta una respuesta, sobra un tipo o hay un campo mal formado → `upstream`.
 */
export function parseSystemOneResponse<Q extends DecisionQuestions>(
  questions: Q,
  raw: unknown,
): ParsedSystemOneResponse<Q> {
  if (!isPlainObject(raw)) throw malformed('el cuerpo no es un objeto');
  const { model, answers, usage } = raw;
  if (typeof model !== 'string' || model.length === 0) throw malformed('falta `model`');
  if (!isPlainObject(answers)) throw malformed('falta `answers`');

  const parsed: Record<string, DecisionAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = parseAnswer(id, question, answers[id]);
    assertAnswerMatches(id, question, answer);
    parsed[id] = answer;
  }

  return { answers: toTypedAnswers<Q>(parsed), model, usage: parseUsage(usage) };
}

function parseUsage(usage: unknown): DecisionUsage {
  if (!isPlainObject(usage)) throw malformed('falta `usage`');
  const { input_tokens: inputTokens, output_tokens: outputTokens } = usage;
  if (!isFiniteNumber(inputTokens) || !isFiniteNumber(outputTokens)) {
    throw malformed('`usage` no trae `input_tokens`/`output_tokens` numéricos');
  }
  return { inputTokens, outputTokens };
}

function parseAnswer(id: string, question: DecisionQuestion, raw: unknown): DecisionAnswer {
  if (!isPlainObject(raw)) throw malformed(`falta la respuesta a "${id}"`);
  if (raw.type !== question.type) {
    throw malformed(
      `la respuesta a "${id}" es de tipo ${String(raw.type)}; se esperaba ${question.type}`,
    );
  }
  switch (question.type) {
    case 'noul':
      return parseNoul(id, raw);
    case 'choice':
      return parseChoice(id, question, raw);
    case 'score':
      return parseScore(id, question, raw);
  }
}

function parseNoul(id: string, raw: Record<string, unknown>): NoulAnswer {
  if (!isFiniteNumber(raw.noul))
    throw malformed(`la respuesta a "${id}" no trae \`noul\` numérico`);
  return { type: 'noul', probability: raw.noul };
}

/** Las opciones ausentes en `probabilities` quedan en 0. */
function parseChoice(
  id: string,
  question: ChoiceQuestion,
  raw: Record<string, unknown>,
): ChoiceAnswer {
  const { choice, probabilities, confidence } = raw;
  if (typeof choice !== 'string') throw malformed(`la respuesta a "${id}" no trae \`choice\``);
  if (!isFiniteNumber(confidence))
    throw malformed(`la respuesta a "${id}" no trae \`confidence\` numérico`);
  if (!isPlainObject(probabilities))
    throw malformed(`la respuesta a "${id}" no trae \`probabilities\``);

  const byOption: Record<string, number> = {};
  for (const option of Object.keys(question.criteria)) {
    const p = probabilities[option];
    if (p === undefined) {
      byOption[option] = 0;
      continue;
    }
    if (!isFiniteNumber(p))
      throw malformed(`la probabilidad de "${option}" en "${id}" no es numérica`);
    byOption[option] = p;
  }
  return { type: 'choice', choice, probabilities: byOption, confidence };
}

function parseScore(
  id: string,
  question: ScoreQuestion,
  raw: Record<string, unknown>,
): ScoreAnswer {
  const { score, probabilities, confidence } = raw;
  if (!isFiniteNumber(score)) throw malformed(`la respuesta a "${id}" no trae \`score\` numérico`);
  if (!isFiniteNumber(confidence))
    throw malformed(`la respuesta a "${id}" no trae \`confidence\` numérico`);
  if (!isPlainObject(probabilities))
    throw malformed(`la respuesta a "${id}" no trae \`probabilities\``);

  const byLevel = scoreProbabilitiesToArray(probabilities, question.criteria.length);
  return { type: 'score', score, level: argmax(byLevel), probabilities: byLevel, confidence };
}

/**
 * Mapa `{"0": p, "1": p, …}` → arreglo indexado por nivel, de largo `levels`.
 * Los niveles ausentes quedan en 0; las claves fuera de rango se ignoran.
 */
export function scoreProbabilitiesToArray(
  map: Readonly<Record<string, unknown>>,
  levels: number,
): number[] {
  const out = new Array<number>(levels).fill(0);
  for (const [key, value] of Object.entries(map)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= levels) continue;
    if (!isFiniteNumber(value)) throw malformed(`la probabilidad del nivel ${key} no es numérica`);
    out[index] = value;
  }
  return out;
}

/** Índice del máximo; ante empate gana el índice menor. `-1` si el arreglo está vacío. */
export function argmax(values: readonly number[]): number {
  let best = -1;
  let bestValue = Number.NEGATIVE_INFINITY;
  values.forEach((value, index) => {
    if (value > bestValue) {
      best = index;
      bestValue = value;
    }
  });
  return best;
}

// ── Errores ──────────────────────────────────────────────────────────────────

/**
 * Error del SDK → `DecisionError` (el original queda en `cause`).
 * 401/403 → `auth`; 429 y 529 → `rate_limited`; timeout → `timeout`;
 * 400/422 → `invalid_request`; cancelación → `aborted`; el resto (5xx, conexión) → `upstream`.
 */
export function mapSdkError(error: unknown): DecisionError {
  if (error instanceof DecisionError) return error;
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new DecisionError(
      'auth',
      `Jev rechazó las credenciales (${error.status}). Revisa TYPESAFE_API_KEY.`,
      error,
    );
  }
  if (
    error instanceof RateLimitError ||
    (error instanceof APIError && error.status === JEV_OVERLOADED_STATUS)
  ) {
    return new DecisionError(
      'rate_limited',
      `Jev está limitando las llamadas (${error.status}).`,
      error,
    );
  }
  if (error instanceof APITimeoutError) {
    return new DecisionError('timeout', `Jev no respondió en ${error.timeoutMs} ms.`, error);
  }
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    return new DecisionError(
      'invalid_request',
      `Jev rechazó el request (${error.status}): ${error.message}`,
      error,
    );
  }
  if (error instanceof APIUserAbortError) {
    return new DecisionError('aborted', 'La llamada a Jev se canceló.', error);
  }
  if (error instanceof APIError) {
    return new DecisionError(
      'upstream',
      `Jev respondió con error (${error.status}): ${error.message}`,
      error,
    );
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new DecisionError('upstream', `Falló la llamada a Jev: ${detail}`, error);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function malformed(detail: string): DecisionError {
  return new DecisionError('upstream', `Respuesta inesperada de Jev: ${detail}.`);
}
