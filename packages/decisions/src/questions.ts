/**
 * Constructores de preguntas y validación previa a la red.
 *
 * Todo motor (real o falso) llama a `assertWithinLimits` antes de evaluar, para
 * que un request fuera de límites falle igual en tests y en producción.
 */

import {
  DecisionError,
  type ChoiceQuestion,
  type DecisionAnswer,
  type DecisionAnswers,
  type DecisionEngine,
  type DecisionEngineLimits,
  type DecisionImage,
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
 * Valida la forma de las preguntas contra los límites del motor: al menos una;
 * Choice y Score con una cantidad de opciones/niveles dentro de `limits`.
 * Lanza `DecisionError('invalid_request')`.
 */
export function validateQuestions(
  questions: DecisionQuestions,
  limits: DecisionEngineLimits,
): void {
  const entries = Object.entries(questions);
  if (entries.length === 0) {
    throw new DecisionError('invalid_request', 'Se requiere al menos una pregunta.');
  }
  for (const [id, question] of entries) {
    validateQuestion(id, question, limits);
  }
}

function validateQuestion(
  id: string,
  question: DecisionQuestion,
  limits: DecisionEngineLimits,
): void {
  // `type` se revisa en runtime: el request puede venir de JSON no tipado.
  const type: unknown = question.type;
  if (type === 'noul') return;
  if (type === 'choice') {
    const q = question as ChoiceQuestion;
    const options = isPlainObject(q.criteria) ? Object.keys(q.criteria).length : 0;
    if (options < limits.minChoiceOptions || options > limits.maxChoiceOptions) {
      throw new DecisionError(
        'invalid_request',
        `La pregunta "${id}" (choice) tiene ${options} opciones; se permiten entre ${limits.minChoiceOptions} y ${limits.maxChoiceOptions}.`,
      );
    }
    return;
  }
  if (type === 'score') {
    const q = question as ScoreQuestion;
    const levels = Array.isArray(q.criteria) ? q.criteria.length : 0;
    if (levels < limits.minScoreLevels || levels > limits.maxScoreLevels) {
      throw new DecisionError(
        'invalid_request',
        `La pregunta "${id}" (score) tiene ${levels} niveles; se permiten entre ${limits.minScoreLevels} y ${limits.maxScoreLevels}.`,
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
export function estimateTokens(value: unknown, charsPerToken: number): number {
  const json = JSON.stringify(value);
  if (json === undefined) return 0;
  return Math.ceil(json.length / charsPerToken);
}

/**
 * Valida preguntas, imágenes y contexto antes de la red, con los límites del
 * motor. Cada imagen cuenta `limits.tokensPerImage` dentro del estado. Si
 * `state` + la pregunta más larga supera `maxStatePlusQuestionTokens`, o
 * `state` + todas las preguntas supera `maxRequestTokens` → `context_exceeded`.
 */
export function assertWithinLimits(
  state: DecisionState,
  questions: DecisionQuestions,
  limits: DecisionEngineLimits,
  images: readonly DecisionImage[] = [],
): void {
  validateQuestions(questions, limits);
  validateImages(images);

  const stateTokens =
    estimateTokens(state, limits.charsPerToken) + images.length * limits.tokensPerImage;
  let longest = 0;
  let total = stateTokens;
  for (const [id, question] of Object.entries(questions)) {
    const tokens = estimateTokens({ [id]: question }, limits.charsPerToken);
    longest = Math.max(longest, tokens);
    total += tokens;
  }

  if (stateTokens + longest > limits.maxStatePlusQuestionTokens) {
    throw new DecisionError(
      'context_exceeded',
      `El estado más la pregunta más larga suman ~${stateTokens + longest} tokens; el máximo es ${limits.maxStatePlusQuestionTokens}.`,
    );
  }
  if (total > limits.maxRequestTokens) {
    throw new DecisionError(
      'context_exceeded',
      `El estado más todas las preguntas suman ~${total} tokens; el máximo es ${limits.maxRequestTokens}.`,
    );
  }
}

/**
 * Valida la forma de cada imagen: bytes con `mimeType` `image/*` y `data` en
 * base64 no vacío, o una `url` http(s). Lanza `invalid_request`.
 */
export function validateImages(images: readonly DecisionImage[]): void {
  images.forEach((image, index) => {
    if ('url' in image) {
      if (!isHttpUrl(image.url)) {
        throw new DecisionError(
          'invalid_request',
          `La imagen ${index} no tiene una URL http(s) válida.`,
        );
      }
      return;
    }
    if (typeof image.mimeType !== 'string' || !image.mimeType.startsWith('image/')) {
      throw new DecisionError(
        'invalid_request',
        `La imagen ${index} tiene un mimeType inválido: ${String(image.mimeType)}.`,
      );
    }
    if (
      typeof image.data !== 'string' ||
      image.data.length === 0 ||
      image.data.startsWith('data:')
    ) {
      throw new DecisionError(
        'invalid_request',
        `La imagen ${index} debe traer sus bytes en base64, sin el prefijo data:.`,
      );
    }
  });
}

/**
 * @internal Rechaza imágenes en un motor que no las acepta. Lo llaman los motores
 * antes de `assertWithinLimits`.
 */
export function assertImagesSupported(
  engine: Pick<DecisionEngine, 'name' | 'capabilities'>,
  images: readonly DecisionImage[] | undefined,
): void {
  if (images === undefined || images.length === 0 || engine.capabilities.images) return;
  throw new DecisionError(
    'invalid_request',
    `El motor ${engine.name} no acepta imágenes (llegaron ${images.length}).`,
  );
}

/** @internal Valida el `timeoutMs` de un request (número positivo de ms). */
export function assertValidTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs === undefined) return;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new DecisionError(
      'invalid_request',
      `timeoutMs debe ser un número positivo de ms (llegó ${timeoutMs}).`,
    );
  }
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
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
