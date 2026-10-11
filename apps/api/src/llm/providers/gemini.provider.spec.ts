import { GeminiProvider } from './gemini.provider';
import type {
  LlmAgentEvent,
  LlmAgentRequest,
  LlmCompletionRequest,
  LlmStructuredRequest,
} from '../llm.types';

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
        thoughtSignature?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
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

  it('transporta la thoughtSignature de la function call en providerMetadata', async () => {
    const provider = new GeminiProvider();
    const fake = makeFakeClient([
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'get_heatmap', args: {} }, thoughtSignature: 'sig' }],
            },
          },
        ],
      },
    ]);
    (provider as unknown as { client: unknown }).client = fake;

    const events = await collect(provider.streamWithTools(makeRequest()));

    expect(events).toContainEqual({
      type: 'tool_call',
      id: 'get_heatmap-0',
      name: 'get_heatmap',
      input: {},
      providerMetadata: { thoughtSignature: 'sig' },
    });
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

describe('GeminiProvider.complete', () => {
  function makeCompletionRequest(): LlmCompletionRequest {
    return {
      system: 'sistema',
      prompt: 'analiza la evaluación',
      options: { model: 'gemini-2.5-flash', maxTokens: 8192, temperature: 0 },
    };
  }

  it('usa generateContentStream y ACUMULA el texto de los chunks (JSON completo)', async () => {
    const provider = new GeminiProvider();
    // El JSON llega partido en varios chunks (como haría el streaming real).
    const fake = makeFakeClient([
      { candidates: [{ content: { parts: [{ text: '{"headline":' }] } }] },
      { candidates: [{ content: { parts: [{ text: '"todo ok",' }] } }] },
      { candidates: [{ content: { parts: [{ text: '"n":3}' }] } }] },
      { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = fake;

    const result = await provider.complete(makeCompletionRequest());

    // El caller recibe el JSON COMPLETO acumulado, no un fragmento.
    expect(result).toBe('{"headline":"todo ok","n":3}');
    // Va por STREAMING (no por generateContent): así la conexión no queda idle y
    // no la corta el idle-timeout de egress (~60s en AWS → "fetch failed").
    expect(fake.models.generateContentStream).toHaveBeenCalledTimes(1);
    const cfg = (fake.models.generateContentStream as jest.Mock).mock.calls[0][0].config;
    expect(cfg.responseMimeType).toBe('application/json');
    // Flash → thinking OFF (no truncar el JSON).
    expect(cfg.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
});

describe('GeminiProvider.completeWithUsage', () => {
  it('suma los tokens de razonamiento a la salida facturable', async () => {
    const provider = new GeminiProvider();
    const fake = makeFakeClient([
      {
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
      },
    ]);
    (provider as unknown as { client: unknown }).client = fake;

    const result = await provider.completeWithUsage({
      system: 's',
      prompt: 'p',
      options: { model: 'gemini-2.5-pro', maxTokens: 1024 },
    });

    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('envía la temperatura sólo cuando la solicitud la define', async () => {
    const provider = new GeminiProvider();
    const fake = makeFakeClient([{ candidates: [{ content: { parts: [{ text: '{}' }] } }] }]);
    (provider as unknown as { client: unknown }).client = fake;

    await provider.completeWithUsage({
      system: 's',
      prompt: 'p',
      options: { model: 'gemini-3.5-flash', maxTokens: 1024 },
    });
    await provider.completeWithUsage({
      system: 's',
      prompt: 'p',
      options: { model: 'gemini-3.5-flash', maxTokens: 1024, temperature: 0 },
    });

    const calls = fake.models.generateContentStream.mock.calls as unknown as Array<
      [{ config: Record<string, unknown> }]
    >;
    expect(calls[0]?.[0].config).not.toHaveProperty('temperature');
    expect(calls[1]?.[0].config).toMatchObject({ temperature: 0 });
  });
});

interface FakeStructuredResponse {
  responseId?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  };
}

const STRUCTURED_SCHEMA = {
  type: 'object',
  properties: { literal: { type: 'string' }, confidence: { type: 'number' } },
  required: ['literal', 'confidence'],
};

function makeStructuredProvider(response: FakeStructuredResponse) {
  const provider = new GeminiProvider();
  const generateContent = jest.fn((_req: Record<string, unknown>) => Promise.resolve(response));
  (provider as unknown as { client: unknown }).client = { models: { generateContent } };
  return { provider, generateContent };
}

function makeStructuredRequest(
  overrides: Partial<LlmStructuredRequest['options']> = {},
): LlmStructuredRequest {
  return {
    system: 'transcribe sin corregir',
    prompt: 'lee la respuesta',
    images: [{ mimeType: 'image/jpeg', data: 'QUJD' }],
    jsonSchema: STRUCTURED_SCHEMA,
    schemaName: 'transcription',
    propertyOrder: ['literal', 'confidence'],
    options: {
      model: 'gemini-3.5-flash-lite',
      maxTokens: 512,
      reasoning: 'off',
      timeoutMs: 15_000,
      ...overrides,
    },
  };
}

const STRUCTURED_RESPONSE: FakeStructuredResponse = {
  responseId: 'resp-1',
  candidates: [
    {
      finishReason: 'STOP',
      content: {
        parts: [
          { text: 'pensando…', thought: true },
          { text: '{"literal":"2,5",' },
          { text: '"confidence":0.9}' },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 300,
    candidatesTokenCount: 15,
    thoughtsTokenCount: 5,
    cachedContentTokenCount: 0,
    promptTokensDetails: [
      { modality: 'TEXT', tokenCount: 40 },
      { modality: 'IMAGE', tokenCount: 260 },
    ],
  },
};

describe('GeminiProvider.completeStructured', () => {
  it('arma la request con imagen antes del texto, JSON schema, resolución y thinking mínimo', async () => {
    const { provider, generateContent } = makeStructuredProvider(STRUCTURED_RESPONSE);

    await provider.completeStructured(makeStructuredRequest({ mediaResolution: 'high' }));

    expect(generateContent.mock.calls[0]?.[0]).toEqual({
      model: 'gemini-3.5-flash-lite',
      contents: [
        { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } },
        { text: 'lee la respuesta' },
      ],
      config: {
        systemInstruction: 'transcribe sin corregir',
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        responseJsonSchema: STRUCTURED_SCHEMA,
        httpOptions: { timeout: 15_000 },
        mediaResolution: 'MEDIA_RESOLUTION_HIGH',
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
      },
    });
  });

  it.each([
    ['gemini-3.5-flash-lite', 'medium', { thinkingLevel: 'MEDIUM' }],
    ['gemini-3.1-pro', 'off', { thinkingLevel: 'LOW' }],
    ['gemini-2.5-flash', 'off', { thinkingBudget: 0 }],
    ['gemini-2.5-pro', 'off', { thinkingBudget: 128 }],
    ['gemini-2.5-flash', 'low', { thinkingBudget: 1024 }],
  ] as const)('traduce el razonamiento de %s (%s)', async (model, reasoning, thinkingConfig) => {
    const { provider, generateContent } = makeStructuredProvider(STRUCTURED_RESPONSE);

    await provider.completeStructured(makeStructuredRequest({ model, reasoning, maxTokens: 4096 }));

    const request = generateContent.mock.calls[0]?.[0] as { config: Record<string, unknown> };
    expect(request.config.thinkingConfig).toEqual(thinkingConfig);
  });

  it.each([
    ['gemini-2.5-flash', 8192, { thinkingBudget: 4096 }],
    ['gemini-2.5-flash', 16384, { thinkingBudget: 8192 }],
    ['gemini-2.5-pro', 2048, { thinkingBudget: 1024 }],
    ['gemini-2.5-pro', 200, { thinkingBudget: 128 }],
  ] as const)(
    'deja al menos la mitad del tope para la respuesta en %s con %i tokens (medium)',
    async (model, maxTokens, thinkingConfig) => {
      const { provider, generateContent } = makeStructuredProvider(STRUCTURED_RESPONSE);

      await provider.completeStructured(
        makeStructuredRequest({ model, reasoning: 'medium', maxTokens }),
      );

      const request = generateContent.mock.calls[0]?.[0] as { config: Record<string, unknown> };
      expect(request.config.thinkingConfig).toEqual(thinkingConfig);
    },
  );

  it('omite thinkingConfig y mediaResolution en modelos sin razonamiento configurable', async () => {
    const { provider, generateContent } = makeStructuredProvider(STRUCTURED_RESPONSE);

    await provider.completeStructured(makeStructuredRequest({ model: 'gemini-2.0-flash' }));

    const request = generateContent.mock.calls[0]?.[0] as { config: Record<string, unknown> };
    expect(request.config).not.toHaveProperty('thinkingConfig');
    expect(request.config).not.toHaveProperty('mediaResolution');
    expect(request.config).not.toHaveProperty('temperature');
  });

  it('parsea el texto sin las partes de pensamiento y reporta el uso con tokens de imagen', async () => {
    const { provider } = makeStructuredProvider(STRUCTURED_RESPONSE);

    const result = await provider.completeStructured(makeStructuredRequest());

    expect(result).toEqual({
      data: { literal: '2,5', confidence: 0.9 },
      rawText: '{"literal":"2,5","confidence":0.9}',
      model: 'gemini-3.5-flash-lite',
      finishReason: 'stop',
      usage: {
        inputTokens: 300,
        outputTokens: 20,
        reasoningTokens: 5,
        cachedInputTokens: 0,
        imageTokens: 260,
      },
      providerRequestId: 'resp-1',
    });
  });

  it.each([
    [{ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'max_tokens'],
    [{ candidates: [{ finishReason: 'SAFETY' }] }, 'safety'],
    [{ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, 'safety'],
    [{ candidates: [{ finishReason: 'RECITATION' }] }, 'other'],
  ] as Array<[FakeStructuredResponse, string]>)(
    'traduce el cierre %j a %s',
    async (response, finishReason) => {
      const { provider } = makeStructuredProvider(response);

      const result = await provider.completeStructured(makeStructuredRequest());

      expect(result.finishReason).toBe(finishReason);
      expect(result.data).toBeNull();
      expect(result.usage).toBeNull();
    },
  );

  it('reporta imageTokens null si el proveedor no detalla modalidades', async () => {
    const { provider } = makeStructuredProvider({
      ...STRUCTURED_RESPONSE,
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
    });

    const result = await provider.completeStructured(makeStructuredRequest());

    expect(result.usage?.imageTokens).toBeNull();
  });
});
