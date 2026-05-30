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

/** Parámetros de inferencia para una llamada concreta. */
export interface LlmCompletionOptions {
  /** Identificador del modelo en el proveedor (p. ej. `gemini-2.0-flash`). */
  model: string;
  /** Máximo de tokens de salida. */
  maxTokens: number;
  /** Temperatura de muestreo (0 = determinista). Opcional por proveedor. */
  temperature?: number;
}

/** Solicitud normalizada e independiente del proveedor. */
export interface LlmCompletionRequest {
  /** Instrucción de sistema / rol. */
  system: string;
  /** Prompt del usuario. */
  prompt: string;
  /** Parámetros de inferencia resueltos por la configuración activa. */
  options: LlmCompletionOptions;
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
