/**
 * Motor falso para tests y desarrollo sin API key. Valida los mismos límites que
 * el real y registra cada request recibido en `calls`.
 */

import {
  DecisionError,
  type DecisionAnswer,
  type DecisionEngine,
  type DecisionQuestion,
  type DecisionQuestions,
  type DecisionRequest,
  type DecisionResult,
  type DecisionState,
  type DecisionUsage,
} from '../contracts';
import { assertAnswerMatches, assertWithinLimits, toTypedAnswers } from '../questions';

/** Respuesta programada: un valor fijo o una función del estado y la pregunta. */
export type FakeAnswer =
  | DecisionAnswer
  | ((state: DecisionState, question: DecisionQuestion) => DecisionAnswer);

export interface FakeDecisionEngineOptions {
  /** Respuestas por id de pregunta. Sin respuesta programada se usa `defaultFakeAnswer`. */
  readonly answers?: Readonly<Record<string, FakeAnswer>>;
  /** Default: `true`. Con `false`, `evaluate` lanza `unavailable`. */
  readonly available?: boolean;
  /** Si está, `evaluate` lo lanza tras validar los límites. */
  readonly error?: DecisionError;
  /** Default: `'fake-1.0.0'`. */
  readonly model?: string;
  readonly usage?: DecisionUsage;
}

export const FAKE_MODEL = 'fake-1.0.0';

export class FakeDecisionEngine implements DecisionEngine {
  readonly name = 'fake';
  /** Requests recibidos, en orden (también los que fallaron). */
  readonly calls: DecisionRequest<DecisionQuestions>[] = [];
  answers: Record<string, FakeAnswer>;
  available: boolean;
  /** Error programado; `undefined` para responder normal. */
  error: DecisionError | undefined;
  private readonly model: string;
  private readonly usage: DecisionUsage;

  constructor(options: FakeDecisionEngineOptions = {}) {
    this.answers = { ...options.answers };
    this.available = options.available ?? true;
    this.error = options.error;
    this.model = options.model ?? FAKE_MODEL;
    this.usage = options.usage ?? { inputTokens: 0, outputTokens: 0 };
  }

  isAvailable(): boolean {
    return this.available;
  }

  async evaluate<Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
  ): Promise<DecisionResult<Q>> {
    this.calls.push(request);
    assertWithinLimits(request.state, request.questions);
    if (!this.available)
      throw new DecisionError('unavailable', 'El motor falso está marcado como no disponible.');
    if (this.error !== undefined) throw this.error;

    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const answer = this.resolveAnswer(id, request.state, question);
      assertAnswerMatches(id, question, answer);
      answers[id] = answer;
    }

    return {
      answers: toTypedAnswers<Q>(answers),
      model: request.model ?? this.model,
      usage: this.usage,
      latencyMs: 0,
      engine: this.name,
    };
  }

  /** Vacía el registro de llamadas. */
  reset(): void {
    this.calls.length = 0;
  }

  private resolveAnswer(
    id: string,
    state: DecisionState,
    question: DecisionQuestion,
  ): DecisionAnswer {
    const programmed = this.answers[id];
    if (programmed === undefined) return defaultFakeAnswer(question);
    return typeof programmed === 'function' ? programmed(state, question) : programmed;
  }
}

/**
 * Respuesta neutra por tipo: Noul 0.5; Choice la primera opción con probabilidad
 * uniforme; Score nivel 0 con probabilidad uniforme (`score` = valor esperado).
 * Choice y Score con `confidence` 0.
 */
export function defaultFakeAnswer(question: DecisionQuestion): DecisionAnswer {
  switch (question.type) {
    case 'noul':
      return { type: 'noul', probability: 0.5 };
    case 'choice': {
      const options = Object.keys(question.criteria);
      const first = options[0];
      if (first === undefined)
        throw new DecisionError('invalid_request', 'Una pregunta choice requiere opciones.');
      const probabilities: Record<string, number> = {};
      for (const option of options) probabilities[option] = 1 / options.length;
      return { type: 'choice', choice: first, probabilities, confidence: 0 };
    }
    case 'score': {
      const levels = question.criteria.length;
      const probabilities = new Array<number>(levels).fill(1 / levels);
      return { type: 'score', score: (levels - 1) / 2, level: 0, probabilities, confidence: 0 };
    }
  }
}
