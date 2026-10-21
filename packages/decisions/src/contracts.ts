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
 * Cada adaptador (`jev/`, `openai/`) es el único lugar que conoce el SDK de su
 * proveedor.
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

/** El contenido a evaluar, como texto o JSON. Las imágenes van aparte, en `DecisionRequest.images`. */
export type DecisionState = string | JsonObject | JsonArray;

/**
 * Imagen adjunta al estado. Misma forma que `LlmImagePart` de la API:
 * bytes en base64 (sin el prefijo `data:`) o una URL http(s) pública o firmada.
 * Solo la aceptan los motores con `capabilities.images`.
 */
export type DecisionImage =
  | { readonly mimeType: string; readonly data: string }
  | { readonly url: string };

// ── Preguntas ────────────────────────────────────────────────────────────────

/** Sí/no. La respuesta es la probabilidad de "sí". No trae `confidence`. */
export interface NoulQuestion {
  readonly type: 'noul';
  readonly instructions: Description;
  readonly criteria?: { readonly true?: Description; readonly false?: Description };
}

/** Elige UNA opción de un conjunto cerrado (entre `limits.minChoiceOptions` y `limits.maxChoiceOptions` del motor). */
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
  /**
   * Imágenes que se evalúan junto con `state`. Van fuera del estado para que
   * `redactState`, el hash del estado y los consumidores de solo texto no cambien.
   * Un motor sin `capabilities.images` las rechaza con `invalid_request`.
   */
  readonly images?: readonly DecisionImage[];
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
  /**
   * Modelo que respondió, tal como lo informa el proveedor. Jev devuelve la
   * versión (`jev-1.13.0`); OpenAI devuelve `gpt-6-luna` sin versión.
   */
  readonly model: string;
  readonly usage: DecisionUsage;
  /** Latencia de punta a punta medida por el adaptador, en ms. */
  readonly latencyMs: number;
  /** Nombre del motor (`DecisionEngine.name`). */
  readonly engine: string;
}

// ── Motor ────────────────────────────────────────────────────────────────────

/** Qué acepta el motor además de texto. */
export interface DecisionEngineCapabilities {
  /** `true` si acepta `DecisionRequest.images`. */
  readonly images: boolean;
}

/**
 * Límites del motor, validados ANTES de llamar (`assertWithinLimits`). Los
 * tokens se estiman: preferimos rechazar de más a que el proveedor rechace.
 */
export interface DecisionEngineLimits {
  readonly minChoiceOptions: number;
  readonly maxChoiceOptions: number;
  readonly minScoreLevels: number;
  readonly maxScoreLevels: number;
  /** `state` (con sus imágenes) + la pregunta más larga. */
  readonly maxStatePlusQuestionTokens: number;
  /** `state` (con sus imágenes) + todas las preguntas. */
  readonly maxRequestTokens: number;
  /** Caracteres del JSON serializado por token (estimación conservadora). */
  readonly charsPerToken: number;
  /** Tokens que se cuentan por imagen (estimación conservadora; 0 si no acepta imágenes). */
  readonly tokensPerImage: number;
}

export interface DecisionEngine {
  /** Identificador estable del motor: `'jev'`, `'openai'`, `'fake'`. */
  readonly name: string;
  readonly capabilities: DecisionEngineCapabilities;
  readonly limits: DecisionEngineLimits;
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
  /** El llamador canceló la llamada (`signal`). No es una falla del proveedor. */
  'aborted',
  /** 401 / 403: key inválida o sin permiso. */
  'auth',
  /** Cualquier otra falla del proveedor (5xx, conexión, respuesta inesperada). */
  'upstream',
  /** El modelo se negó a responder al menos una pregunta (OpenAI: `type: "refusal"`). */
  'refused',
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
