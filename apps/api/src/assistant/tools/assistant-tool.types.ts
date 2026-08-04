import type { JwtPayload } from '../../auth/jwt-payload.types';
import type { LlmToolDefinition } from '../../llm/llm.types';

/**
 * Contrato compartido de las tools del asistente IA (E21, Ola 2).
 *
 * Cada tool es un wrapper DELGADO sobre un service de dominio existente
 * (Dashboards, Heatmap, Analytics, AssessmentReport, …): valida el input que
 * propone el modelo, llama al service con la identidad del JWT y devuelve un
 * payload compacto. NUNCA accede a Drizzle directo — así hereda `withOrgContext`
 * + RLS + scoping por rol del service (CLAUDE.md §4.3, §5.2).
 *
 * El `AssistantModule` (Ola 3) registra todas las tools, expone sus
 * `definition` al modelo y construye el `executeTool` del `LlmAgentService`
 * resolviendo por `definition.name`.
 */

/**
 * Contexto de ejecución de una tool. El `user` viene del JWT autenticado —
 * NUNCA del modelo. El `orgId`/roles para el aislamiento multi-tenant salen de
 * aquí, no de los argumentos que propone el LLM (guardrail §4.2/§4.4).
 */
export interface AssistantToolContext {
  user: JwtPayload;
}

/** Resultado de una tool, listo para reinyectarse al modelo. */
export interface AssistantToolResult {
  /** Contenido serializado (JSON) que ve el modelo. Compacto y grounded. */
  content: string;
  /** `true` si la tool falló — el modelo debe reaccionar al error. */
  isError?: boolean;
}

/**
 * Una tool del asistente. Implementaciones: clases `@Injectable()` que inyectan
 * el service de dominio que envuelven y exponen:
 *  - `definition`: la descripción + JSON Schema del input que ve el modelo.
 *  - `execute(input, ctx)`: valida `input` (Zod), llama al service con `ctx.user`
 *    y serializa la respuesta.
 */
export interface AssistantTool {
  /** Definición provider-agnóstica que se entrega al modelo. */
  readonly definition: LlmToolDefinition;
  /** Ejecuta la tool. `input` es lo que propuso el modelo (validar siempre). */
  execute(
    input: unknown,
    ctx: AssistantToolContext,
  ): Promise<AssistantToolResult>;
}
