/**
 * Contratos del módulo LLM provider-agnóstico.
 *
 * Toda integración con un proveedor (Anthropic, Gemini, OpenAI, DeepSeek, …)
 * implementa `LlmProvider`. Los consumidores (p. ej. `AiTaggingService`) hablan
 * solo con `LlmService`, nunca con un SDK concreto. Cambiar de proveedor/modelo
 * no requiere tocar a los consumidores — solo la configuración.
 */

/** Identificadores estables de proveedores soportados o planificados. */
export type LlmProviderName = 'anthropic' | 'gemini' | 'openai' | 'deepseek';

// El propósito de una completion se modela con `LlmFeature` (de `@soe/types`): cada
// funcionalidad de IA declara su feature y `LlmConfigService.resolve(orgId, feature)`
// resuelve proveedor+modelo desde `llm_settings` (panel /configuracion/modelos-ia).

/** Parámetros de inferencia para una llamada concreta. */
export interface LlmCompletionOptions {
  /** Identificador del modelo en el proveedor (p. ej. `gemini-2.0-flash`). */
  model: string;
  /** Máximo de tokens de salida. */
  maxTokens: number;
  /** Temperatura de muestreo (0 = determinista). Opcional por proveedor. */
  temperature?: number;
}

/** Imagen adjunta a una completion multimodal (best-effort). */
export interface LlmImagePart {
  /** MIME del binario (p. ej. `image/png`, `image/jpeg`). */
  mimeType: string;
  /** Contenido binario codificado en base64 (sin prefijo `data:`). */
  data: string;
}

/** Solicitud normalizada e independiente del proveedor. */
export interface LlmCompletionRequest {
  /** Instrucción de sistema / rol. */
  system: string;
  /** Prompt del usuario. */
  prompt: string;
  /** Parámetros de inferencia resueltos por la configuración activa. */
  options: LlmCompletionOptions;
  /**
   * Imágenes a incluir en la completion (multimodal, best-effort). Solo las
   * consume `completeMultimodal`; `complete` (texto) las ignora. Opcional: si no
   * se entrega o el provider no soporta multimodal, el análisis cae a solo-texto.
   */
  images?: LlmImagePart[];
}

/**
 * Interfaz que implementa cada integración con un proveedor LLM.
 *
 * Cada provider es autónomo: lee su propia API key, inicializa su SDK de forma
 * perezosa y tolera la ausencia del paquete/clave (degradación elegante via
 * `isAvailable()`).
 */
export interface LlmProvider {
  /** Nombre estable usado por el registry para resolver el provider activo. */
  readonly name: LlmProviderName;
  /** `true` si el provider tiene credenciales y SDK listos para usar. */
  isAvailable(): boolean;
  /** Ejecuta una completion y devuelve el texto plano de la respuesta. */
  complete(request: LlmCompletionRequest): Promise<string>;
  /**
   * Ejecuta una completion MULTIMODAL (texto + imágenes) y devuelve texto plano.
   * OPCIONAL: si el provider no lo implementa, `LlmService.completeMultimodal`
   * degrada elegantemente a `complete` (solo texto).
   */
  completeMultimodal?(request: LlmCompletionRequest): Promise<string>;
  /**
   * Ejecuta una vuelta agéntica con tool-use y STREAMING. Emite eventos
   * (`text_delta`, `tool_call`, `usage`, `done`) a medida que el modelo produce
   * texto o decide invocar una tool. OPCIONAL: si el provider no lo implementa,
   * `LlmAgentService` lanza un error claro (no hay degradación posible — el loop
   * conversacional requiere tool-use nativo). Ver `LlmAgentRequest`/`LlmAgentEvent`.
   */
  streamWithTools?(request: LlmAgentRequest): AsyncIterable<LlmAgentEvent>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Contrato agéntico (tool-use + streaming) — base del asistente conversacional.
// Provider-agnóstico: cada provider traduce estos tipos a su SDK (Anthropic
// `tools`, Gemini `functionDeclarations`, …). El loop vive en `LlmAgentService`.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Definición de una tool expuesta al modelo. `inputSchema` es un JSON Schema
 * (derivado de un schema Zod en `packages/types`) que describe los parámetros.
 */
export interface LlmToolDefinition {
  /** Identificador estable de la tool (p. ej. `get_heatmap`). */
  name: string;
  /** Descripción en lenguaje natural — el modelo decide cuándo llamarla. */
  description: string;
  /** JSON Schema del input (objeto raíz con `type: 'object'`, `properties`, …). */
  inputSchema: Record<string, unknown>;
}

/** Rol de un mensaje en el historial agéntico. */
export type LlmAgentRole = 'user' | 'assistant';

/**
 * Bloques que componen un mensaje del historial agéntico. Un turno del asistente
 * puede mezclar texto y varias invocaciones de tool; los resultados se reinyectan
 * como bloques `tool_result` dentro de un mensaje `user`.
 */
export type LlmAgentContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      /** Referencia al `id` del `tool_use` que originó este resultado. */
      toolCallId: string;
      /** Contenido serializado (JSON) que ve el modelo. */
      content: string;
      /** `true` si la tool falló — el modelo debe reaccionar al error. */
      isError?: boolean;
    };

/** Mensaje del historial agéntico (multi-bloque). */
export interface LlmAgentMessage {
  role: LlmAgentRole;
  content: LlmAgentContent[];
}

/** Razón por la que el modelo detuvo la generación en una vuelta. */
export type LlmAgentStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'other';

/**
 * Evento emitido por `streamWithTools`. El provider los produce en orden a
 * medida que llega la respuesta; `LlmAgentService` los consume para conducir el
 * loop y reenviar `text_delta` al frontend (SSE).
 */
export type LlmAgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: LlmAgentStopReason };

/** Solicitud de una vuelta agéntica (provider-agnóstica). */
export interface LlmAgentRequest {
  /** Instrucción de sistema (guardrails + rol del asistente). */
  system: string;
  /** Historial completo de la conversación hasta ahora. */
  messages: LlmAgentMessage[];
  /** Tools disponibles para el modelo en esta vuelta. */
  tools: LlmToolDefinition[];
  /** Parámetros de inferencia resueltos por la configuración activa. */
  options: LlmCompletionOptions;
}

/**
 * Configuración LLM efectiva resuelta en tiempo de ejecución.
 *
 * Hoy proviene de constantes/env; en F2+ podrá provenir de la tabla
 * `llm_settings` por organización (ver `LlmConfigService`).
 */
export interface LlmRuntimeConfig {
  provider: LlmProviderName;
  model: string;
  maxTokens: number;
  temperature?: number;
}
