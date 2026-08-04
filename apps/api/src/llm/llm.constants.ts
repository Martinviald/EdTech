import type { LlmProviderName } from './llm.types';

/**
 * Parámetros estáticos de cada proveedor LLM.
 *
 * ── PUNTO ÚNICO DE CONFIGURACIÓN ──
 * Para cambiar de modelo dentro de un proveedor, edita su `model`.
 * Para cambiar de proveedor activo, edita `ACTIVE_LLM_PROVIDER` (abajo) o define
 * la variable de entorno `LLM_PROVIDER`.
 *
 * ── MIGRACIÓN A BASE DE DATOS (F2+) ──
 * `LlmConfigService.resolve()` es el ÚNICO lugar que lee estas constantes.
 * Cuando exista la tabla `llm_settings`, ese método consultará la BD por
 * `org_id` y usará estos valores como fallback. Ni los providers ni los
 * consumidores (`AiTaggingService`, etc.) necesitan cambiar.
 */
export interface ProviderStaticConfig {
  /** Nombre de la variable de entorno que contiene la API key del proveedor. */
  apiKeyEnv: string;
  /** Modelo baseline del proveedor (fallback; la elección real vive en `llm_settings`). */
  model: string;
  /** Máximo de tokens de salida baseline. */
  maxTokens: number;
  /** Temperatura de muestreo (0 = determinista, recomendado para etiquetado). */
  temperature: number;
}

export const LLM_PROVIDER_DEFAULTS: Record<LlmProviderName, ProviderStaticConfig> = {
  anthropic: {
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0,
  },
  gemini: {
    apiKeyEnv: 'GEMINI_API_KEY',
    // Baseline. El modelo/budget reales por funcionalidad salen de `llm_settings`
    // (panel) con fallback a `LLM_FEATURE_DEFAULTS` + catálogo (`@soe/types`).
    model: 'gemini-2.5-flash',
    maxTokens: 8192,
    temperature: 0,
  },
  // ── Puntos de extensión ──
  // Para activarlos: implementar el provider en `providers/`, registrarlo en
  // `LlmModule` y apuntar `ACTIVE_LLM_PROVIDER` aquí.
  openai: {
    apiKeyEnv: 'OPENAI_API_KEY',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0,
  },
  deepseek: {
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat',
    maxTokens: 4096,
    temperature: 0,
  },
};

/** Conjunto de proveedores válidos, derivado de las constantes. */
const VALID_PROVIDERS = Object.keys(LLM_PROVIDER_DEFAULTS) as LlmProviderName[];

function isValidProvider(value: string | undefined): value is LlmProviderName {
  return value !== undefined && VALID_PROVIDERS.includes(value as LlmProviderName);
}

/**
 * Proveedor LLM activo por defecto.
 *
 * Cambiar esta constante (o definir la env `LLM_PROVIDER`) conmuta el proveedor
 * en todo el sistema. Si `LLM_PROVIDER` trae un valor inválido, se ignora.
 */
export const ACTIVE_LLM_PROVIDER: LlmProviderName = isValidProvider(
  process.env.LLM_PROVIDER,
)
  ? process.env.LLM_PROVIDER
  : 'gemini';

/** Token de inyección para la lista de providers registrados en `LlmModule`. */
export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
