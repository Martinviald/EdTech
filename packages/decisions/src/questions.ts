/**
 * Constructores de preguntas y validación previa a la red.
 *
 * Todo motor (real o falso) llama a `assertWithinLimits` antes de evaluar, para
 * que un request fuera de límites falle igual en tests y en producción.
 */

import {
  DECISION_LIMITS,
  DecisionError,
  type ChoiceQuestion,
  type DecisionAnswer,
  type DecisionAnswers,
  type DecisionQuestion,
  type DecisionQuestions,
  type DecisionState,
  type Description,
  type NoulQuestion,
  type ScoreQuestion,
} from './contracts';

// ── Constructores ────────────────────────────────────────────────────────────
// Solo arman el objeto: los límites los valida `validateQuestions` / `evaluate`.

/** Pregunta sí/no. La respuesta es P(sí). */
export function noul(instructions: Description, criteria?: NoulQuestion['criteria']): NoulQuestion {
  return criteria === undefined
    ? { type: 'noul', instructions }
    : { type: 'noul', instructions, criteria };
}

/**
 * Pregunta de opción única. Las claves de `criteria` quedan como literales, así
 * `answers.x.choice` se tipa como la unión de opciones.
 */
export function choice<const K extends string>(
  instructions: Description,
  criteria: Record<K, Description | null>,
): ChoiceQuestion<K> {
  return { type: 'choice', instructions, criteria };
}

/** Pregunta de escala ordenada: `levels[i]` describe el nivel `i` (de menor a mayor). */
export function score(instructions: Description, levels: readonly Description[]): ScoreQuestion {
  return { type: 'score', instructions, criteria: levels };
}

// ── Validación ───────────────────────────────────────────────────────────────

/**
 * Valida la forma de las preguntas: al menos una; Choice con 1..255 opciones;
 * Score con 2..10 niveles. Lanza `DecisionError('invalid_request')`.
 */
export function validateQuestions(questions: DecisionQuestions): void {
  const entries = Object.entries(questions);
  if (entries.length === 0) {
    throw new DecisionError('invalid_request', 'Se requiere al menos una pregunta.');
  }
  for (const [id, question] of entries) {
    validateQuestion(id, question);
  }
}

function validateQuestion(id: string, question: DecisionQuestion): void {
  // `type` se revisa en runtime: el request puede venir de JSON no tipado.
  const type: unknown = question.type;
  if (type === 'noul') return;
  if (type === 'choice') {
    const q = question as ChoiceQuestion;
    const options = isPlainObject(q.criteria) ? Object.keys(q.criteria).length : 0;
    if (options < 1 || options > DECISION_LIMITS.maxChoiceOptions) {
      throw new DecisionError(
        'invalid_request',
        `La pregunta "${id}" (choice) tiene ${options} opciones; se permiten entre 1 y ${DECISION_LIMITS.maxChoiceOptions}.`,
      );
    }
    return;
  }
  if (type === 'score') {
    const q = question as ScoreQuestion;
    const levels = Array.isArray(q.criteria) ? q.criteria.length : 0;
    if (levels < DECISION_LIMITS.minScoreLevels || levels > DECISION_LIMITS.maxScoreLevels) {
      throw new DecisionError(
        'invalid_request',
        `La pregunta "${id}" (score) tiene ${levels} niveles; se permiten entre ${DECISION_LIMITS.minScoreLevels} y ${DECISION_LIMITS.maxScoreLevels}.`,
      );
    }
    return;
  }
  throw new DecisionError(
    'invalid_request',
    `La pregunta "${id}" tiene un tipo desconocido: ${String(type)}.`,
  );
}

/** Tokens estimados: `ceil(JSON.stringify(value).length / charsPerToken)`. */
export function estimateTokens(value: unknown): number {
  const json = JSON.stringify(value);
  if (json === undefined) return 0;
  return Math.ceil(json.length / DECISION_LIMITS.charsPerToken);
}

/**
 * Valida preguntas y contexto antes de la red. `state` + la pregunta más larga
 * ≤ 32k tokens y `state` + todas las preguntas ≤ 64k; si no, `context_exceeded`.
 */
export function assertWithinLimits(state: DecisionState, questions: DecisionQuestions): void {
  validateQuestions(questions);

  const stateTokens = estimateTokens(state);
  let longest = 0;
  let total = stateTokens;
  for (const [id, question] of Object.entries(questions)) {
    const tokens = estimateTokens({ [id]: question });
    longest = Math.max(longest, tokens);
    total += tokens;
  }

  if (stateTokens + longest > DECISION_LIMITS.maxStatePlusQuestionTokens) {
    throw new DecisionError(
      'context_exceeded',
      `El estado más la pregunta más larga suman ~${stateTokens + longest} tokens; el máximo es ${DECISION_LIMITS.maxStatePlusQuestionTokens}.`,
    );
  }
  if (total > DECISION_LIMITS.maxRequestTokens) {
    throw new DecisionError(
      'context_exceeded',
      `El estado más todas las preguntas suman ~${total} tokens; el máximo es ${DECISION_LIMITS.maxRequestTokens}.`,
    );
  }
}

// ── Helpers internos (los usan los motores; no se re-exportan en index) ─────

/** @internal Verifica que la respuesta calce con el tipo de su pregunta. */
export function assertAnswerMatches(
  id: string,
  question: DecisionQuestion,
  answer: DecisionAnswer,
): void {
  if (answer.type !== question.type) {
    throw new DecisionError(
      'upstream',
      `La respuesta a "${id}" es de tipo ${answer.type}, pero la pregunta es de tipo ${question.type}.`,
    );
  }
  if (
    answer.type === 'choice' &&
    question.type === 'choice' &&
    !Object.hasOwn(question.criteria, answer.choice)
  ) {
    throw new DecisionError(
      'upstream',
      `La respuesta a "${id}" eligió una opción inexistente: "${answer.choice}".`,
    );
  }
}

/**
 * @internal Convierte el mapa id → respuesta ya validado al tipo inferido.
 * La correspondencia tipo↔pregunta la garantiza `assertAnswerMatches`; TypeScript
 * no puede probarla sobre un mapa construido en runtime.
 */
export function toTypedAnswers<Q extends DecisionQuestions>(
  answers: Readonly<Record<string, DecisionAnswer>>,
): DecisionAnswers<Q> {
  return answers as unknown as DecisionAnswers<Q>;
}

/** @internal */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
