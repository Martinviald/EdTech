/**
 * Traducción entre los contratos del paquete y OpenAI Decisions (`POST /v1/decisions`).
 * La respuesta se trata como `unknown` y se valida campo a campo: la API está en
 * beta pública y el contrato puede cambiar antes de GA.
 */

import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from 'openai';
import type {
  DecisionCreateParams,
  DecisionInputMessage,
  DecisionInputPart,
} from 'openai/resources/decisions';

import {
  DecisionError,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type DecisionAnswer,
  type DecisionAnswers,
  type DecisionImage,
  type DecisionQuestion,
  type DecisionQuestions,
  type DecisionState,
  type DecisionUsage,
  type Description,
  type NoulAnswer,
  type NoulQuestion,
  type ScoreAnswer,
  type ScoreQuestion,
} from '../contracts';
import {
  argmax,
  choiceProbabilities,
  isFiniteNumber,
  levelProbabilitiesToArray,
  malformed as malformedFrom,
} from '../mapping-helpers';
import { assertAnswerMatches, isPlainObject, toTypedAnswers } from '../questions';

const PROVIDER = 'OpenAI';

/** Mensaje con que OpenAI rechaza un input que excede el contexto (400 sin `code`). */
const TOKEN_LIMIT_PATTERN = /exceeds the token limit/i;

export type OpenAiQuestion =
  | DecisionCreateParams.QuestionParamPredicate
  | DecisionCreateParams.QuestionParamChoice
  | DecisionCreateParams.QuestionParamScore;

// ── Request ──────────────────────────────────────────────────────────────────

/** Preguntas del paquete → `questions[]` de OpenAI. El id viaja como `name`. */
export function toOpenAiQuestions(questions: DecisionQuestions): OpenAiQuestion[] {
  return Object.entries(questions).map(([id, question]) => toOpenAiQuestion(id, question));
}

function toOpenAiQuestion(id: string, question: DecisionQuestion): OpenAiQuestion {
  switch (question.type) {
    case 'noul':
      return { type: 'predicate', name: id, instructions: predicateInstructions(question) };
    case 'choice':
      return {
        type: 'choice',
        name: id,
        instructions: describe(question.instructions),
        choices: Object.entries(question.criteria).map(([value, description]) =>
          description === null ? { value } : { value, description: describe(description) },
        ),
      };
    case 'score':
      return {
        type: 'score',
        name: id,
        instructions: describe(question.instructions),
        levels: question.criteria.map((level, index) => ({
          label: `Nivel ${index}`,
          description: describe(level),
        })),
      };
  }
}

/**
 * `predicate` no tiene criterios aparte: los de Noul se agregan a las
 * instrucciones como "Verdadero si: …" / "Falso si: …".
 */
function predicateInstructions(question: NoulQuestion): string {
  const lines = [describe(question.instructions)];
  if (question.criteria?.true !== undefined) {
    lines.push(`Verdadero si: ${describe(question.criteria.true)}`);
  }
  if (question.criteria?.false !== undefined) {
    lines.push(`Falso si: ${describe(question.criteria.false)}`);
  }
  return lines.join('\n');
}

/** OpenAI solo acepta texto: una `Description` en JSON se serializa. */
export function describe(description: Description): string {
  return typeof description === 'string' ? description : JSON.stringify(description);
}

/**
 * Estado (+ imágenes) → `input` de OpenAI. Sin imágenes es un string; con
 * imágenes, un mensaje `user` con el estado como `input_text` seguido de un
 * `input_image` por imagen (data URL o URL http(s)).
 */
export function toOpenAiInput(
  state: DecisionState,
  images: readonly DecisionImage[] = [],
): string | DecisionInputMessage[] {
  const text = typeof state === 'string' ? state : JSON.stringify(state);
  if (images.length === 0) return text;
  const content: DecisionInputPart[] = [{ type: 'input_text', text }];
  for (const image of images) {
    content.push({ type: 'input_image', image_url: imageUrl(image) });
  }
  return [{ role: 'user', content }];
}

function imageUrl(image: DecisionImage): string {
  return 'url' in image ? image.url : `data:${image.mimeType};base64,${image.data}`;
}

// ── Response ─────────────────────────────────────────────────────────────────

export interface ParsedDecisionResponse<Q extends DecisionQuestions> {
  readonly answers: DecisionAnswers<Q>;
  readonly model: string;
  readonly usage: DecisionUsage;
}

/**
 * Valida la respuesta cruda de `POST /v1/decisions` contra las preguntas pedidas.
 * Las respuestas vienen en un arreglo y se indexan por `name` (= id de la pregunta).
 * Si alguna viene como `refusal` → `DecisionError('refused')` con los ids
 * rechazados. Falta una respuesta, sobra un tipo o hay un campo mal formado → `upstream`.
 */
export function parseDecisionResponse<Q extends DecisionQuestions>(
  questions: Q,
  raw: unknown,
): ParsedDecisionResponse<Q> {
  if (!isPlainObject(raw)) throw malformed('el cuerpo no es un objeto');
  const { model, answers, usage } = raw;
  if (typeof model !== 'string' || model.length === 0) throw malformed('falta `model`');
  if (!Array.isArray(answers)) throw malformed('falta `answers`');

  const byName = indexAnswersByName(answers);
  const refused: string[] = [];
  const parsed: Record<string, DecisionAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const rawAnswer = byName.get(id);
    if (rawAnswer === undefined) throw malformed(`falta la respuesta a "${id}"`);
    if (rawAnswer.type === 'refusal') {
      refused.push(id);
      continue;
    }
    const answer = parseAnswer(id, question, rawAnswer);
    assertAnswerMatches(id, question, answer);
    parsed[id] = answer;
  }

  if (refused.length > 0) {
    throw new DecisionError(
      'refused',
      `OpenAI se negó a responder ${refused.map((id) => `"${id}"`).join(', ')}.`,
      { refusedQuestionIds: refused },
    );
  }

  return { answers: toTypedAnswers<Q>(parsed), model, usage: parseUsage(usage) };
}

function indexAnswersByName(answers: readonly unknown[]): Map<string, Record<string, unknown>> {
  const byName = new Map<string, Record<string, unknown>>();
  for (const answer of answers) {
    if (!isPlainObject(answer)) throw malformed('una respuesta no es un objeto');
    const { name } = answer;
    if (typeof name !== 'string') throw malformed('una respuesta no trae `name`');
    if (byName.has(name)) throw malformed(`la respuesta a "${name}" viene repetida`);
    byName.set(name, answer);
  }
  return byName;
}

/** OpenAI cobra solo la entrada; `output_tokens` llega en 0 pero se registra igual. */
function parseUsage(usage: unknown): DecisionUsage {
  if (!isPlainObject(usage)) throw malformed('falta `usage`');
  const { input_tokens: inputTokens, output_tokens: outputTokens } = usage;
  if (!isFiniteNumber(inputTokens) || !isFiniteNumber(outputTokens)) {
    throw malformed('`usage` no trae `input_tokens`/`output_tokens` numéricos');
  }
  return { inputTokens, outputTokens };
}

const OPENAI_TYPE: Readonly<Record<DecisionQuestion['type'], string>> = {
  noul: 'predicate',
  choice: 'choice',
  score: 'score',
};

function parseAnswer(
  id: string,
  question: DecisionQuestion,
  raw: Record<string, unknown>,
): DecisionAnswer {
  const expected = OPENAI_TYPE[question.type];
  if (raw.type !== expected) {
    throw malformed(
      `la respuesta a "${id}" es de tipo ${String(raw.type)}; se esperaba ${expected}`,
    );
  }
  switch (question.type) {
    case 'noul':
      return parsePredicate(id, raw);
    case 'choice':
      return parseChoice(id, question, raw);
    case 'score':
      return parseScore(id, question, raw);
  }
}

function parsePredicate(id: string, raw: Record<string, unknown>): NoulAnswer {
  if (!isFiniteNumber(raw.probability)) {
    throw malformed(`la respuesta a "${id}" no trae \`probability\` numérico`);
  }
  return { type: 'noul', probability: raw.probability };
}

/** `probabilities: [{ value, probability }]` → mapa por opción; las ausentes quedan en 0. */
function parseChoice(
  id: string,
  question: ChoiceQuestion,
  raw: Record<string, unknown>,
): ChoiceAnswer {
  const { choice, probabilities, confidence } = raw;
  if (typeof choice !== 'string') throw malformed(`la respuesta a "${id}" no trae \`choice\``);
  if (!isFiniteNumber(confidence)) {
    throw malformed(`la respuesta a "${id}" no trae \`confidence\` numérico`);
  }
  const entries = probabilityEntries(id, probabilities);
  const byValue = new Map<unknown, unknown>(entries);
  const byOption = choiceProbabilities(
    Object.keys(question.criteria),
    (option) => byValue.get(option),
    PROVIDER,
    id,
  );
  return { type: 'choice', choice, probabilities: byOption, confidence };
}

/** `probabilities: [{ value: índice, label, probability }]` → arreglo por nivel. */
function parseScore(
  id: string,
  question: ScoreQuestion,
  raw: Record<string, unknown>,
): ScoreAnswer {
  const { score, probabilities, confidence } = raw;
  if (!isFiniteNumber(score)) throw malformed(`la respuesta a "${id}" no trae \`score\` numérico`);
  if (!isFiniteNumber(confidence)) {
    throw malformed(`la respuesta a "${id}" no trae \`confidence\` numérico`);
  }
  const byLevel = levelProbabilitiesToArray(
    probabilityEntries(id, probabilities),
    question.criteria.length,
    PROVIDER,
  );
  return { type: 'score', score, level: argmax(byLevel), probabilities: byLevel, confidence };
}

function probabilityEntries(id: string, probabilities: unknown): Array<[unknown, unknown]> {
  if (!Array.isArray(probabilities)) {
    throw malformed(`la respuesta a "${id}" no trae \`probabilities\``);
  }
  return probabilities.map((entry: unknown): [unknown, unknown] => {
    if (!isPlainObject(entry)) {
      throw malformed(`una probabilidad de "${id}" no es un objeto`);
    }
    return [entry.value, entry.probability];
  });
}

// ── Errores ──────────────────────────────────────────────────────────────────

/**
 * Error del SDK → `DecisionError` (el original queda en `cause`).
 * 401/403 → `auth`; 429 → `rate_limited`; timeout → `timeout`; 400 por tokens →
 * `context_exceeded`; otros 400/404/422 → `invalid_request` (404 = modelo
 * inexistente); cancelación → `aborted`; el resto (5xx, conexión) → `upstream`.
 */
export function mapSdkError(error: unknown): DecisionError {
  if (error instanceof DecisionError) return error;
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new DecisionError(
      'auth',
      `OpenAI rechazó las credenciales (${error.status}). Revisa OPENAI_API_KEY.`,
      error,
    );
  }
  if (error instanceof RateLimitError) {
    return new DecisionError(
      'rate_limited',
      `OpenAI está limitando las llamadas (${error.status}).`,
      error,
    );
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new DecisionError('timeout', 'OpenAI no respondió a tiempo.', error);
  }
  if (error instanceof BadRequestError && TOKEN_LIMIT_PATTERN.test(error.message)) {
    return new DecisionError(
      'context_exceeded',
      `OpenAI rechazó el request por tamaño: ${error.message}`,
      error,
    );
  }
  if (
    error instanceof BadRequestError ||
    error instanceof NotFoundError ||
    error instanceof UnprocessableEntityError
  ) {
    return new DecisionError(
      'invalid_request',
      `OpenAI rechazó el request (${error.status}): ${error.message}`,
      error,
    );
  }
  if (error instanceof APIUserAbortError) {
    return new DecisionError('aborted', 'La llamada a OpenAI se canceló.', error);
  }
  if (error instanceof APIError) {
    const status = error.status === undefined ? 'sin status' : String(error.status);
    return new DecisionError(
      'upstream',
      `OpenAI respondió con error (${status}): ${error.message}`,
      error,
    );
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new DecisionError('upstream', `Falló la llamada a OpenAI: ${detail}`, error);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function malformed(detail: string): DecisionError {
  return malformedFrom(PROVIDER, detail);
}
