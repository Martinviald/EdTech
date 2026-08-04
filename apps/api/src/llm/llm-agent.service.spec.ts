import { ServiceUnavailableException } from '@nestjs/common';
import { LlmAgentService, type AgentStreamEvent } from './llm-agent.service';
import type { LlmConfigService } from './llm.config';
import type {
  LlmAgentEvent,
  LlmAgentRequest,
  LlmCompletionRequest,
  LlmProvider,
} from './llm.types';

// ──────────────────────────────────────────────────────────────────────────────
// Provider mock: scriptea las vueltas de streamWithTools. Cada elemento de
// `script` es la lista de eventos que emite UNA vuelta (una llamada al provider).
// Permite simular el loop modelo→tool→modelo sin SDK real ni red.
// ──────────────────────────────────────────────────────────────────────────────

function makeProvider(
  script: LlmAgentEvent[][],
  overrides: Partial<LlmProvider> = {},
): LlmProvider {
  let turn = 0;
  return {
    name: 'anthropic',
    isAvailable: () => true,
    complete: (_req: LlmCompletionRequest) => Promise.resolve(''),
    streamWithTools(_req: LlmAgentRequest): AsyncIterable<LlmAgentEvent> {
      const events = script[turn] ?? [{ type: 'done', stopReason: 'end_turn' }];
      turn++;
      return (async function* () {
        for (const e of events) yield e;
      })();
    },
    ...overrides,
  };
}

function makeConfig(provider = 'anthropic'): LlmConfigService {
  return {
    resolve: () =>
      Promise.resolve({
        provider: provider as 'anthropic',
        model: 'claude-test',
        maxTokens: 1024,
        temperature: 0,
      }),
  } as unknown as LlmConfigService;
}

async function collect(
  gen: AsyncGenerator<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('LlmAgentService', () => {
  it('conduce el loop modelo→tool→modelo y cierra en prosa', async () => {
    const provider = makeProvider([
      // Vuelta 1: el modelo dice algo y pide una tool.
      [
        { type: 'usage', inputTokens: 100, outputTokens: 20 },
        { type: 'text_delta', text: 'Déjame revisar. ' },
        { type: 'tool_call', id: 'tc-1', name: 'get_heatmap', input: { classGroupId: 'cg-1' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      // Vuelta 2: con el resultado de la tool, responde final.
      [
        { type: 'usage', inputTokens: 150, outputTokens: 40 },
        { type: 'text_delta', text: 'El 8°B bajó en fracciones.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const service = new LlmAgentService(makeConfig(), [provider]);

    const executeTool = jest.fn().mockResolvedValue({
      content: JSON.stringify({ rows: [{ skill: 'fracciones', achievement: 38 }] }),
    });

    const events = await collect(
      service.runAgent({
        system: 'eres un asistente',
        messages: [{ role: 'user', content: [{ type: 'text', text: '¿qué pasó con el 8°B?' }] }],
        tools: [{ name: 'get_heatmap', description: 'mapa de calor', inputSchema: { type: 'object' } }],
        executeTool,
        maxSteps: 6,
      }),
    );

    // La tool se ejecutó con el input que pidió el modelo.
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith({
      id: 'tc-1',
      name: 'get_heatmap',
      input: { classGroupId: 'cg-1' },
    });

    // Se emitieron los deltas de texto de ambas vueltas, el tool_call y el tool_result.
    const textDeltas = events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text);
    expect(textDeltas).toEqual(['Déjame revisar. ', 'El 8°B bajó en fracciones.']);
    expect(events.some((e) => e.type === 'tool_call')).toBe(true);
    expect(events.some((e) => e.type === 'tool_result' && !e.isError)).toBe(true);

    // Evento final: texto del último turno, uso acumulado, 2 pasos, sin truncar.
    const final = events.find((e) => e.type === 'final');
    expect(final).toMatchObject({
      type: 'final',
      text: 'El 8°B bajó en fracciones.',
      usage: { inputTokens: 250, outputTokens: 60 },
      steps: 2,
      truncated: false,
    });

    // El historial resultante tiene: assistant(text+tool_use), user(tool_result), assistant(text).
    const messages = (final as { messages: unknown[] }).messages;
    expect(messages).toHaveLength(4); // 1 user inicial + 3 generados
  });

  it('reinyecta el error si la tool falla (isError) y deja que el modelo siga', async () => {
    const provider = makeProvider([
      [
        { type: 'tool_call', id: 'tc-err', name: 'get_heatmap', input: {} },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text_delta', text: 'No pude obtener ese dato.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const service = new LlmAgentService(makeConfig(), [provider]);
    const executeTool = jest.fn().mockRejectedValue(new Error('boom'));

    const events = await collect(
      service.runAgent({
        system: 's',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        tools: [{ name: 'get_heatmap', description: 'd', inputSchema: { type: 'object' } }],
        executeTool,
      }),
    );

    // Una excepción en la tool NO tumba el loop: se reinyecta como tool_result isError.
    expect(events.some((e) => e.type === 'tool_result' && e.isError)).toBe(true);
    expect(events.find((e) => e.type === 'final')).toMatchObject({
      text: 'No pude obtener ese dato.',
      truncated: false,
    });
  });

  it('corta en maxSteps si el modelo nunca deja de pedir tools (cortafuegos)', async () => {
    // Provider que SIEMPRE pide una tool → loop infinito sin el tope.
    const alwaysCallsTool = makeProvider([], {
      streamWithTools(): AsyncIterable<LlmAgentEvent> {
        return (async function* () {
          yield { type: 'tool_call', id: 'tc', name: 'loop', input: {} };
          yield { type: 'done', stopReason: 'tool_use' };
        })();
      },
    });
    const service = new LlmAgentService(makeConfig(), [alwaysCallsTool]);
    const executeTool = jest.fn().mockResolvedValue({ content: '{}' });

    const events = await collect(
      service.runAgent({
        system: 's',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        tools: [{ name: 'loop', description: 'd', inputSchema: { type: 'object' } }],
        executeTool,
        maxSteps: 3,
      }),
    );

    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(events.find((e) => e.type === 'final')).toMatchObject({
      steps: 3,
      truncated: true,
    });
  });

  it('lanza error claro si el provider activo no soporta tool-use', async () => {
    const noTools = makeProvider([], { streamWithTools: undefined });
    const service = new LlmAgentService(makeConfig(), [noTools]);

    await expect(
      collect(
        service.runAgent({
          system: 's',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
          tools: [],
          executeTool: jest.fn(),
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
