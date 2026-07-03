import { GeminiProvider } from './gemini.provider';
import type { LlmAgentEvent, LlmAgentRequest } from '../llm.types';

// ──────────────────────────────────────────────────────────────────────────────
// Fake del cliente @google/genai: scriptea `generateContentStream` con un async
// iterable de chunks (texto → function call → cierre con finishReason). Se inyecta
// en la instancia vía `(provider as any).client` para no depender del SDK real.
// ──────────────────────────────────────────────────────────────────────────────

interface FakeChunk {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { name?: string; args?: Record<string, unknown> };
      }>;
    };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function makeFakeClient(chunks: FakeChunk[]) {
  return {
    models: {
      generateContentStream: jest.fn(
        (): Promise<AsyncIterable<FakeChunk>> =>
          Promise.resolve(
            (async function* () {
              for (const c of chunks) yield c;
            })(),
          ),
      ),
    },
  };
}

async function collect(gen: AsyncIterable<LlmAgentEvent>): Promise<LlmAgentEvent[]> {
  const out: LlmAgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function makeRequest(): LlmAgentRequest {
  return {
    system: 'eres un asistente',
    messages: [{ role: 'user', content: [{ type: 'text', text: '¿qué pasó con el 8°B?' }] }],
    tools: [
      {
        name: 'get_heatmap',
        description: 'mapa de calor',
        inputSchema: { type: 'object' },
      },
    ],
    options: { model: 'gemini-2.0-flash', maxTokens: 1024, temperature: 0 },
  };
}

describe('GeminiProvider.streamWithTools', () => {
  it('emite text_delta, tool_call y done en orden', async () => {
    const provider = new GeminiProvider();
    const fake = makeFakeClient([
      // Chunk 1: texto incremental.
      { candidates: [{ content: { parts: [{ text: 'Déjame revisar. ' }] } }] },
      // Chunk 2: una function call.
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'get_heatmap',
                    args: { classGroupId: 'cg-1' },
                  },
                },
              ],
            },
          },
        ],
      },
      // Chunk 3: cierre con finishReason + uso de tokens.
      {
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = fake;

    const events = await collect(provider.streamWithTools(makeRequest()));

    // 1) Primer evento: el delta de texto.
    expect(events[0]).toEqual({ type: 'text_delta', text: 'Déjame revisar. ' });

    // 2) Se emitió el tool_call con name e input correctos, y un id determinista.
    const toolCall = events.find((e) => e.type === 'tool_call');
    expect(toolCall).toEqual({
      type: 'tool_call',
      id: 'get_heatmap-0',
      name: 'get_heatmap',
      input: { classGroupId: 'cg-1' },
    });

    // 3) El uso de tokens se tradujo desde usageMetadata.
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 20,
    });

    // 4) Cierre: hubo function call → stopReason 'tool_use' (prioridad sobre STOP).
    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'done', stopReason: 'tool_use' });

    // 5) El orden relativo se respeta: text_delta antes que tool_call antes que done.
    const order = events.map((e) => e.type);
    expect(order.indexOf('text_delta')).toBeLessThan(order.indexOf('tool_call'));
    expect(order.indexOf('tool_call')).toBeLessThan(order.indexOf('done'));
  });

  it('cierra con end_turn cuando no hay function calls (STOP puro)', async () => {
    const provider = new GeminiProvider();
    const fake = makeFakeClient([
      {
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Listo.' }] } }],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = fake;

    const events = await collect(provider.streamWithTools(makeRequest()));

    expect(events).toContainEqual({ type: 'text_delta', text: 'Listo.' });
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      stopReason: 'end_turn',
    });
  });

  it('lanza si el cliente no está disponible', async () => {
    const provider = new GeminiProvider();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = null;

    await expect(collect(provider.streamWithTools(makeRequest()))).rejects.toThrow(
      'Gemini provider no está disponible',
    );
  });

  it('omite `parameters` para tools sin propiedades y lo conserva si las tiene (fix 400 Gemini)', async () => {
    const provider = new GeminiProvider();
    const fake = makeFakeClient([{ candidates: [{ finishReason: 'STOP' }] }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = fake;

    const request: LlmAgentRequest = {
      system: 's',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      tools: [
        {
          name: 'list_filter_options',
          description: 'sin args',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'get_heatmap',
          description: 'con args',
          inputSchema: {
            type: 'object',
            properties: { classGroupId: { type: 'string' } },
            required: [],
          },
        },
      ],
      options: { model: 'gemini-2.0-flash', maxTokens: 1024, temperature: 0 },
    };

    await collect(provider.streamWithTools(request));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArg = (fake.models.generateContentStream as jest.Mock).mock.calls[0][0] as any;
    const decls = callArg.config.tools[0].functionDeclarations;
    const noArg = decls.find((d: { name: string }) => d.name === 'list_filter_options');
    const withArg = decls.find((d: { name: string }) => d.name === 'get_heatmap');

    // Sin propiedades → `parameters` OMITIDO (Gemini rechaza el objeto vacío).
    expect('parameters' in noArg).toBe(false);
    // Con propiedades → se conserva tal cual.
    expect(withArg.parameters).toEqual({
      type: 'object',
      properties: { classGroupId: { type: 'string' } },
      required: [],
    });
  });
});
