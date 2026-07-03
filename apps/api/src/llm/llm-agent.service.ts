import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { LlmFeature } from '@soe/types';
import { LlmConfigService } from './llm.config';
import { LLM_PROVIDERS } from './llm.constants';
import type {
  LlmAgentContent,
  LlmAgentMessage,
  LlmProvider,
  LlmProviderName,
  LlmToolDefinition,
} from './llm.types';

/**
 * Resultado de ejecutar una tool, listo para reinyectarse al modelo.
 * `content` es texto serializado (típicamente JSON) que el modelo lee.
 */
export interface AgentToolResult {
  content: string;
  isError?: boolean;
}

/**
 * Callback que ejecuta una tool solicitada por el modelo. Lo provee el módulo
 * consumidor (p. ej. `AssistantModule`), que resuelve la tool por nombre y corre
 * el service correspondiente con el `orgId`/roles del JWT — NUNCA del modelo.
 */
export type AgentToolExecutor = (call: {
  id: string;
  name: string;
  input: unknown;
}) => Promise<AgentToolResult>;

/** Parámetros para conducir una conversación agéntica. */
export interface RunAgentParams {
  /** Instrucción de sistema (guardrails + rol). */
  system: string;
  /** Historial de la conversación (incluye el último mensaje del usuario). */
  messages: LlmAgentMessage[];
  /** Tools disponibles para el modelo. */
  tools: LlmToolDefinition[];
  /** Ejecutor de tools (resuelve y corre la tool con contexto del JWT). */
  executeTool: AgentToolExecutor;
  /** Tenant para resolución de config por organización. */
  orgId?: string | null;
  /**
   * Funcionalidad de IA (resuelve proveedor+modelo desde `llm_settings`). Default:
   * `'assistant'`. Se acepta como parámetro para mantener el loop agéntico genérico.
   */
  feature?: LlmFeature;
  /**
   * Tope de vueltas modelo→tool→modelo (cortafuegos de costo/loop infinito).
   * Si se alcanza, se cierra con `final.truncated = true`. Default: 6.
   */
  maxSteps?: number;
}

/** Uso acumulado de tokens en toda la conversación agéntica. */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Evento que `runAgent` emite hacia el consumidor. `text_delta` se reenvía al
 * frontend (SSE); `tool_call`/`tool_result` permiten mostrar "consultando
 * datos…"; `final` cierra el turno con el texto completo, el uso y el historial
 * actualizado (para persistir).
 */
export type AgentStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; isError: boolean }
  | {
      type: 'final';
      text: string;
      usage: AgentUsage;
      steps: number;
      truncated: boolean;
      messages: LlmAgentMessage[];
    };

const DEFAULT_MAX_STEPS = 6;

/**
 * Conduce el loop agéntico provider-agnóstico: stream del modelo → si pide
 * tools, las ejecuta y reinyecta sus resultados → repite hasta que el modelo
 * responde sin más tool-calls (o se alcanza `maxSteps`).
 *
 * No conoce las tools concretas: recibe sus definiciones y un `executeTool`. El
 * aislamiento multi-tenant y el scoping por rol viven en el `executeTool` del
 * consumidor (que corre los services dentro de `withOrgContext`), no aquí.
 */
@Injectable()
export class LlmAgentService {
  private readonly logger = new Logger(LlmAgentService.name);
  private readonly registry: Map<LlmProviderName, LlmProvider>;

  constructor(
    private readonly config: LlmConfigService,
    @Inject(LLM_PROVIDERS) providers: LlmProvider[],
  ) {
    this.registry = new Map(providers.map((p) => [p.name, p]));
  }

  /**
   * Ejecuta la conversación agéntica como un async generator. El consumidor
   * itera los eventos y los reenvía (texto al SSE, etc.). El historial de
   * entrada NO se muta: se trabaja sobre una copia y se devuelve el resultante
   * en el evento `final`.
   */
  async *runAgent(params: RunAgentParams): AsyncGenerator<AgentStreamEvent> {
    const feature: LlmFeature = params.feature ?? 'assistant';
    const provider = await this.resolveProvider(params.orgId, feature);
    const cfg = await this.config.resolve(params.orgId, feature);
    const maxSteps = params.maxSteps ?? DEFAULT_MAX_STEPS;

    const messages: LlmAgentMessage[] = [...params.messages];
    const usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
    let lastText = '';

    for (let step = 1; step <= maxSteps; step++) {
      const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
      let textBuffer = '';

      for await (const event of provider.streamWithTools!({
        system: params.system,
        messages,
        tools: params.tools,
        options: {
          model: cfg.model,
          maxTokens: cfg.maxTokens,
          temperature: cfg.temperature,
        },
      })) {
        switch (event.type) {
          case 'text_delta':
            textBuffer += event.text;
            yield { type: 'text_delta', text: event.text };
            break;
          case 'tool_call':
            toolCalls.push({
              id: event.id,
              name: event.name,
              input: event.input,
            });
            yield {
              type: 'tool_call',
              id: event.id,
              name: event.name,
              input: event.input,
            };
            break;
          case 'usage':
            usage.inputTokens += event.inputTokens;
            usage.outputTokens += event.outputTokens;
            break;
          case 'done':
            break;
        }
      }

      lastText = textBuffer;

      // Reconstruir el turno del asistente (texto + tool_use) en el historial.
      const assistantContent: LlmAgentContent[] = [];
      if (textBuffer.length > 0) {
        assistantContent.push({ type: 'text', text: textBuffer });
      }
      for (const call of toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.input,
        });
      }
      if (assistantContent.length > 0) {
        messages.push({ role: 'assistant', content: assistantContent });
      }

      // Sin tool-calls → el modelo respondió en prosa: fin del turno.
      if (toolCalls.length === 0) {
        yield {
          type: 'final',
          text: lastText,
          usage,
          steps: step,
          truncated: false,
          messages,
        };
        return;
      }

      // Ejecutar cada tool y reinyectar resultados como un mensaje `user`.
      const resultBlocks: LlmAgentContent[] = [];
      for (const call of toolCalls) {
        let result: AgentToolResult;
        try {
          result = await params.executeTool(call);
        } catch (err) {
          this.logger.warn(
            `Tool "${call.name}" lanzó una excepción: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          result = {
            content: JSON.stringify({
              error: `La tool "${call.name}" falló al ejecutarse.`,
            }),
            isError: true,
          };
        }
        resultBlocks.push({
          type: 'tool_result',
          toolCallId: call.id,
          content: result.content,
          isError: result.isError,
        });
        yield {
          type: 'tool_result',
          id: call.id,
          name: call.name,
          isError: result.isError ?? false,
        };
      }
      messages.push({ role: 'user', content: resultBlocks });
    }

    // Se alcanzó el tope de pasos sin que el modelo cerrara en prosa.
    this.logger.warn(
      `Loop agéntico alcanzó maxSteps=${maxSteps} sin respuesta final.`,
    );
    yield {
      type: 'final',
      text: lastText,
      usage,
      steps: maxSteps,
      truncated: true,
      messages,
    };
  }

  /** Resuelve el provider activo y verifica que soporte tool-use con streaming. */
  private async resolveProvider(
    orgId: string | null | undefined,
    feature: LlmFeature,
  ): Promise<LlmProvider & { streamWithTools: NonNullable<LlmProvider['streamWithTools']> }> {
    const cfg = await this.config.resolve(orgId, feature);
    const provider = this.registry.get(cfg.provider);

    if (!provider) {
      throw new ServiceUnavailableException(
        `LLM provider "${cfg.provider}" no está registrado`,
      );
    }
    if (!provider.isAvailable()) {
      throw new ServiceUnavailableException(
        `LLM provider "${cfg.provider}" no está disponible — revisa su API key`,
      );
    }
    if (!provider.streamWithTools) {
      throw new ServiceUnavailableException(
        `LLM provider "${cfg.provider}" no soporta tool-use con streaming ` +
          `(requerido por el asistente conversacional)`,
      );
    }
    return provider as LlmProvider & {
      streamWithTools: NonNullable<LlmProvider['streamWithTools']>;
    };
  }
}
