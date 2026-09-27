/**
 * Contratos del motor de decisiones (`@soe/decisions`).
 *
 * Un motor de decisiones evalúa un ESTADO (texto o JSON) contra un mapa de
 * PREGUNTAS TIPADAS y devuelve una respuesta tipada por pregunta, con
 * probabilidades y confianza. No genera texto: para eso está `LlmService`.
 *
 * Este archivo es la fuente de verdad compartida entre el paquete, la API
 * (`apps/api/src/decisions`) y los scripts de calibración. Ningún consumidor
 * importa el SDK del proveedor: solo estos tipos y la interfaz `DecisionEngine`.
 * El adaptador de Jev (`jev/jev-engine.ts`) es el único archivo que conoce el SDK.
 */

// ── JSON ─────────────────────────────────────────────────────────────────────

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

/**
 * Texto o estructura que describe una instrucción, una opción o un nivel.
 * Un objeto permite separar la pregunta de los datos que referencia (los datos
 * se nombran entre backticks dentro de la pregunta).
 */
export type Description = string | JsonObject | JsonArray;

/** El contenido a evaluar. Siempre texto: las imágenes se transcriben antes. */
export type DecisionState = string | JsonObject | JsonArray;

// ── Preguntas ────────────────────────────────────────────────────────────────

/** Sí/no. La respuesta es la probabilidad de "sí". No trae `confidence`. */
export interface NoulQuestion {
  readonly type: 'noul';
  readonly instructions: Description;
  readonly criteria?: { readonly true?: Description; readonly false?: Description };
}

/** Elige UNA opción de un conjunto cerrado (máx. `DECISION_LIMITS.maxChoiceOptions`). */
export interface ChoiceQuestion<K extends string = string> {
  readonly type: 'choice';
  readonly instructions: Description;
  /** opción → descripción (`null` si la clave se explica sola). */
  readonly criteria: Readonly<Record<K, Description | null>>;
}

/** Ubica el estado en una escala ORDENADA de niveles (entre 2 y 10). */
export interface ScoreQuestion {
  readonly type: 'score';
  readonly instructions: Description;
  /** Niveles de menor a mayor; el índice del arreglo es el nivel. */
  readonly criteria: readonly Description[];
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion<string> | ScoreQuestion;

/** Mapa id → pregunta. El id es nuestro: no se envía al modelo como contexto. */
export type DecisionQuestions = Readonly<Record<string, DecisionQuestion>>;

// ── Respuestas ───────────────────────────────────────────────────────────────

export interface NoulAnswer {
  readonly type: 'noul';
  /** P(sí), de 0 a 1. */
  readonly probability: number;
}

export interface ChoiceAnswer<K extends string = string> {
  readonly type: 'choice';
  /** La opción de mayor probabilidad. */
  readonly choice: K;
  /** Probabilidad por opción (suman 1). */
  readonly probabilities: Readonly<Record<K, number>>;
  /** 0..1, derivada de la forma de la distribución. */
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly type: 'score';
  /** Valor esperado sobre los niveles (puede caer entre dos). NO interpolar magnitudes. */
  readonly score: number;
  /** Nivel más probable (índice en `criteria`). */
  readonly level: number;
  /** Probabilidad por nivel, indexada como `criteria`. */
  readonly probabilities: readonly number[];
  readonly confidence: number;
}

export type DecisionAnswer = NoulAnswer | ChoiceAnswer<string> | ScoreAnswer;

/** Respuesta inferida desde el tipo de la pregunta. */
export type AnswerFor<Q> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ChoiceQuestion<infer K>
    ? ChoiceAnswer<K>
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : never;

export type DecisionAnswers<Q extends DecisionQuestions> = {
  readonly [K in keyof Q]: AnswerFor<Q[K]>;
};

// ── Request / Result ─────────────────────────────────────────────────────────

export interface DecisionRequest<Q extends DecisionQuestions> {
  readonly state: DecisionState;
  readonly questions: Q;
  /** Modelo versionado o alias. Si falta, el default del motor. */
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface DecisionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface DecisionResult<Q extends DecisionQuestions> {
  readonly answers: DecisionAnswers<Q>;
  /** Modelo VERSIONADO que respondió (p. ej. `jev-1.13.0`), no el alias. */
  readonly model: string;
  readonly usage: DecisionUsage;
  /** Latencia de punta a punta medida por el adaptador, en ms. */
  readonly latencyMs: number;
  /** Nombre del motor (`DecisionEngine.name`). */
  readonly engine: string;
}

// ── Motor ────────────────────────────────────────────────────────────────────

export interface DecisionEngine {
  /** Identificador estable del motor: `'jev'`, `'fake'`. */
  readonly name: string;
  /** `true` si tiene credenciales y puede atender llamadas. */
  isAvailable(): boolean;
  /**
   * Evalúa `state` contra `questions`. Valida los límites ANTES de llamar
   * (lanza `DecisionError` con `invalid_request` o `context_exceeded`).
   * Toda falla remota se traduce a `DecisionError`: nunca se filtra un error del SDK.
   */
  evaluate<Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>>;
}

// ── Errores ──────────────────────────────────────────────────────────────────

export const DECISION_ERROR_CODES = [
  /** Sin credenciales o el motor no está configurado. */
  'unavailable',
  /** La funcionalidad está en modo `off` (lo lanza la API, no el motor). */
  'disabled',
  /** Pregunta mal formada o fuera de límites (opciones, niveles, vacío). */
  'invalid_request',
  /** El estado + preguntas exceden el contexto del modelo. */
  'context_exceeded',
  /** 429 / 529 tras agotar los reintentos. */
  'rate_limited',
  'timeout',
  /** 401 / 403: key inválida o sin permiso. */
  'auth',
  /** Cualquier otra falla del proveedor (5xx, conexión, respuesta inesperada). */
  'upstream',
] as const;
export type DecisionErrorCode = (typeof DECISION_ERROR_CODES)[number];

export class DecisionError extends Error {
  constructor(
    readonly code: DecisionErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DecisionError';
  }
}

// ── Límites (docs.typesafe.ai/models, /api — jev-1.13) ───────────────────────

export const DECISION_LIMITS = {
  maxChoiceOptions: 255,
  minScoreLevels: 2,
  maxScoreLevels: 10,
  /** `state` + la pregunta más larga. */
  maxStatePlusQuestionTokens: 32_000,
  /** `state` + todas las preguntas. */
  maxRequestTokens: 64_000,
  /**
   * Estimación CONSERVADORA de tokens: caracteres del JSON serializado / 3.
   * El español tokeniza peor que el inglés; preferimos rechazar de más.
   */
  charsPerToken: 3,
} as const;

// ── Routing por confianza ────────────────────────────────────────────────────

/** Qué hacer con una respuesta según su confianza. */
export type ConfidenceRoute = 'auto' | 'review' | 'reject';

/**
 * Umbrales para Choice/Score: `confidence >= auto` → `auto`;
 * `>= review` → `review`; si no, `reject`. Invariante: `0 <= review <= auto <= 1`.
 */
export interface ConfidenceThresholds {
  readonly auto: number;
  readonly review: number;
}

/**
 * Umbrales para Noul (no trae confianza): `p >= yes` → `'yes'`;
 * `p <= no` → `'no'`; entre medio → `'uncertain'`. Invariante: `0 <= no < yes <= 1`.
 * NO reutilizar umbrales de Choice en Noul ni viceversa (docs: jaggedness #8).
 */
export interface NoulThresholds {
  readonly yes: number;
  readonly no: number;
}
export type NoulVerdict = 'yes' | 'no' | 'uncertain';
