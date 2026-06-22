import { ForbiddenException, NotFoundException } from '@nestjs/common';

// withOrgContext se reemplaza para correr el callback con el `db` mockeado como
// `tx` (sin transacción ni RLS real). El resto de `@soe/db` (tablas Drizzle) se
// mantiene real para poder despachar las queries del mock por identidad de tabla.
jest.mock('@soe/db', () => {
  const actual = jest.requireActual('@soe/db');
  return {
    __esModule: true,
    ...actual,
    withOrgContext: jest.fn(
      async (db: unknown, _orgId: string, cb: (tx: unknown) => Promise<unknown>) => cb(db),
    ),
  };
});

import { assistantConversations, assistantMessages, type Database } from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { LlmConfigService } from '../llm/llm.config';
import type { AgentStreamEvent, LlmAgentService, RunAgentParams } from '../llm/llm-agent.service';
import { AssistantService } from './assistant.service';
import { ASSISTANT_PROMPT_VERSION, ASSISTANT_SYSTEM_PROMPT } from './assistant.constants';
import type { AssistantTool } from './tools/assistant-tool.types';

// ──────────────────────────────────────────────────────────────────────────────
// Identidad del JWT y mock de DB (chainable, despacha por tabla).
// ──────────────────────────────────────────────────────────────────────────────

const USER: JwtPayload = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 'dir@colegio.cl',
  name: 'Dir',
  isPlatformAdmin: false,
  roles: ['school_admin'],
  activeRole: 'school_admin',
  role: 'school_admin',
};

interface DbState {
  conversations: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  inserted: Array<{ table: unknown; values: Record<string, unknown> }>;
  updated: Array<{ table: unknown; values: Record<string, unknown> }>;
}

function makeDb(state: DbState): Database {
  const db: Record<string, unknown> = {
    select: () => {
      let table: unknown;
      const chain: Record<string, unknown> = {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        then: (resolve: (v: unknown[]) => unknown) => {
          const rows = table === assistantConversations ? state.conversations : state.messages;
          return Promise.resolve(resolve(rows));
        },
      };
      return chain;
    },
    insert: (table: unknown) => {
      let captured: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        values: (v: Record<string, unknown>) => {
          captured = v;
          state.inserted.push({ table, values: v });
          return builder;
        },
        returning: () =>
          Promise.resolve([
            {
              id: 'new-id',
              title: (captured.title as string | null) ?? null,
              orgId: captured.orgId ?? 'org-1',
              userId: captured.userId ?? 'user-1',
              createdAt: new Date('2026-06-01T00:00:00Z'),
              updatedAt: new Date('2026-06-01T00:00:00Z'),
              deletedAt: null,
            },
          ]),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)),
      };
      return builder;
    },
    update: (table: unknown) => {
      let captured: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        set: (v: Record<string, unknown>) => {
          captured = v;
          return builder;
        },
        where: () => {
          state.updated.push({ table, values: captured });
          return Promise.resolve(undefined);
        },
      };
      return builder;
    },
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  };
  return db as unknown as Database;
}

function emptyState(overrides: Partial<DbState> = {}): DbState {
  return {
    conversations: [],
    messages: [],
    inserted: [],
    updated: [],
    ...overrides,
  };
}

function conversationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'conv-1',
    orgId: 'org-1',
    userId: 'user-1',
    title: null,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    updatedAt: new Date('2026-06-01T10:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    orgId: 'org-1',
    role: 'user',
    content: 'hola',
    toolCalls: null,
    model: null,
    promptVersion: null,
    tokens: null,
    costUsd: null,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  };
}

const LLM_CONFIG = {
  resolve: jest.fn(async () => ({
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0,
  })),
} as unknown as LlmConfigService;

/** Agent mock: corre un guion de eventos y captura los `RunAgentParams`. */
function makeAgent(events: AgentStreamEvent[]): {
  agent: LlmAgentService;
  captured: { params?: RunAgentParams };
} {
  const captured: { params?: RunAgentParams } = {};
  const agent = {
    runAgent: jest.fn((params: RunAgentParams) => {
      captured.params = params;
      return (async function* () {
        for (const ev of events) yield ev;
      })();
    }),
  } as unknown as LlmAgentService;
  return { agent, captured };
}

function makeTool(name: string, execute = jest.fn(async () => ({ content: '{}' }))): AssistantTool {
  return {
    definition: { name, description: `desc ${name}`, inputSchema: { type: 'object' } },
    execute,
  };
}

async function drain(gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('AssistantService — CRUD de conversaciones', () => {
  it('createConversation inserta con orgId/userId del JWT y mapea el modelo', async () => {
    const state = emptyState();
    const { agent } = makeAgent([]);
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, []);

    const model = await service.createConversation(USER, { title: 'Mi hilo' });

    expect(model).toEqual({
      id: 'new-id',
      title: 'Mi hilo',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(state.inserted[0]!.values).toMatchObject({
      orgId: 'org-1',
      userId: 'user-1',
      title: 'Mi hilo',
    });
  });

  it('getConversation devuelve la conversación con sus mensajes mapeados', async () => {
    const state = emptyState({
      conversations: [conversationRow({ title: 'T' })],
      messages: [
        messageRow({ id: 'm1', role: 'user', content: 'hola' }),
        messageRow({
          id: 'm2',
          role: 'assistant',
          content: 'respuesta',
          toolCalls: [{ name: 'get_heatmap', input: {}, isError: false }],
        }),
      ],
    });
    const { agent } = makeAgent([]);
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, []);

    const detail = await service.getConversation(USER, 'conv-1');

    expect(detail.id).toBe('conv-1');
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]).toMatchObject({
      id: 'm2',
      role: 'assistant',
      content: 'respuesta',
      toolCalls: [{ name: 'get_heatmap', input: {}, isError: false }],
    });
  });

  it('getConversation lanza 404 si la conversación es de otro usuario', async () => {
    const state = emptyState({
      conversations: [conversationRow({ userId: 'otro-user' })],
    });
    const { agent } = makeAgent([]);
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, []);

    await expect(service.getConversation(USER, 'conv-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteConversation marca deletedAt (soft delete)', async () => {
    const state = emptyState({ conversations: [conversationRow()] });
    const { agent } = makeAgent([]);
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, []);

    await service.deleteConversation(USER, 'conv-1');

    expect(state.updated[0]!.table).toBe(assistantConversations);
    expect(state.updated[0]!.values.deletedAt).toBeInstanceOf(Date);
  });

  it('rechaza usuarios sin org activa (multi-tenancy)', async () => {
    const state = emptyState();
    const { agent } = makeAgent([]);
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, []);

    await expect(service.createConversation({ ...USER, orgId: null }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('AssistantService.streamReply', () => {
  const FINAL_USAGE = { inputTokens: 1000, outputTokens: 500 };

  function scriptedEvents(): AgentStreamEvent[] {
    return [
      { type: 'text_delta', text: 'Veamos ' },
      { type: 'tool_call', id: 't1', name: 'get_heatmap', input: { a: 1 } },
      { type: 'tool_result', id: 't1', name: 'get_heatmap', isError: false },
      { type: 'text_delta', text: 'los datos.' },
      {
        type: 'final',
        text: 'Veamos los datos.',
        usage: FINAL_USAGE,
        steps: 2,
        truncated: false,
        messages: [],
      },
    ];
  }

  it('reemite text_delta/tool_call/tool_result + final, en orden', async () => {
    const state = emptyState({ conversations: [conversationRow({ title: 'T' })] });
    const { agent } = makeAgent(scriptedEvents());
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, [
      makeTool('get_heatmap'),
    ]);

    const events = await drain(service.streamReply(USER, 'conv-1', { content: 'hola' }));

    expect(events.map((e) => e.type)).toEqual([
      'text_delta',
      'tool_call',
      'tool_result',
      'text_delta',
      'final',
    ]);
  });

  it('pasa el system prompt versionado y las definiciones de tools al loop', async () => {
    const state = emptyState({ conversations: [conversationRow({ title: 'T' })] });
    const { agent, captured } = makeAgent(scriptedEvents());
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, [
      makeTool('get_heatmap'),
    ]);

    await drain(service.streamReply(USER, 'conv-1', { content: 'hola' }));

    expect(captured.params?.system).toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(captured.params?.tools).toEqual([
      { name: 'get_heatmap', description: 'desc get_heatmap', inputSchema: { type: 'object' } },
    ]);
    expect(captured.params?.orgId).toBe('org-1');
  });

  it('persiste el turno usuario y el del asistente con trazas, tokens y costo', async () => {
    const state = emptyState({ conversations: [conversationRow({ title: 'T' })] });
    const { agent } = makeAgent(scriptedEvents());
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, [
      makeTool('get_heatmap'),
    ]);

    await drain(service.streamReply(USER, 'conv-1', { content: 'hola' }));

    const userInsert = state.inserted.find(
      (i) => i.table === assistantMessages && i.values.role === 'user',
    );
    const assistantInsert = state.inserted.find(
      (i) => i.table === assistantMessages && i.values.role === 'assistant',
    );

    expect(userInsert?.values).toMatchObject({ content: 'hola', orgId: 'org-1' });
    expect(assistantInsert?.values).toMatchObject({
      content: 'Veamos los datos.',
      model: 'claude-sonnet-4-20250514',
      promptVersion: ASSISTANT_PROMPT_VERSION,
      tokens: { input: 1000, output: 500 },
      toolCalls: [{ name: 'get_heatmap', input: { a: 1 }, isError: false }],
    });
    // claude-sonnet: 1000/1e6*3 + 500/1e6*15 = 0.003 + 0.0075 = 0.0105
    expect(assistantInsert?.values.costUsd).toBe('0.010500');
  });

  it('marca isError en la traza cuando el tool_result falla', async () => {
    const state = emptyState({ conversations: [conversationRow({ title: 'T' })] });
    const events: AgentStreamEvent[] = [
      { type: 'tool_call', id: 't1', name: 'get_heatmap', input: {} },
      { type: 'tool_result', id: 't1', name: 'get_heatmap', isError: true },
      {
        type: 'final',
        text: 'No pude.',
        usage: FINAL_USAGE,
        steps: 1,
        truncated: false,
        messages: [],
      },
    ];
    const { agent } = makeAgent(events);
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, [
      makeTool('get_heatmap'),
    ]);

    await drain(service.streamReply(USER, 'conv-1', { content: 'hola' }));

    const assistantInsert = state.inserted.find(
      (i) => i.table === assistantMessages && i.values.role === 'assistant',
    );
    expect(assistantInsert?.values.toolCalls).toEqual([
      { name: 'get_heatmap', input: {}, isError: true },
    ]);
  });

  it('autogenera el título desde el primer mensaje cuando es null', async () => {
    const state = emptyState({ conversations: [conversationRow({ title: null })] });
    const { agent } = makeAgent(scriptedEvents());
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, [
      makeTool('get_heatmap'),
    ]);

    await drain(
      service.streamReply(USER, 'conv-1', {
        content: '¿Cómo le fue al 8°B en matemática?',
      }),
    );

    const titleUpdate = state.updated.find(
      (u) => u.table === assistantConversations && typeof u.values.title === 'string',
    );
    expect(titleUpdate?.values.title).toBe('¿Cómo le fue al 8°B en matemática?');
  });

  it('executeTool resuelve por nombre e inyecta ctx.user del JWT (no del modelo)', async () => {
    const state = emptyState({ conversations: [conversationRow({ title: 'T' })] });
    const { agent, captured } = makeAgent(scriptedEvents());
    const execute = jest.fn(async () => ({ content: '{"ok":true}' }));
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, [
      makeTool('get_heatmap', execute),
    ]);

    await drain(service.streamReply(USER, 'conv-1', { content: 'hola' }));

    // El loop recibió un executeTool; lo invocamos como lo haría el modelo.
    const result = await captured.params!.executeTool({
      id: 't9',
      name: 'get_heatmap',
      input: { classGroupId: 'x' },
    });
    expect(execute).toHaveBeenCalledWith({ classGroupId: 'x' }, { user: USER });
    expect(result).toEqual({ content: '{"ok":true}' });
  });

  it('executeTool devuelve error serializado para una tool desconocida', async () => {
    const state = emptyState({ conversations: [conversationRow({ title: 'T' })] });
    const { agent, captured } = makeAgent(scriptedEvents());
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, [
      makeTool('get_heatmap'),
    ]);

    await drain(service.streamReply(USER, 'conv-1', { content: 'hola' }));

    const result = await captured.params!.executeTool({
      id: 't9',
      name: 'no_existe',
      input: {},
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toContain('no_existe');
  });

  it('inyecta studentRefs (UUID) como contexto en el mensaje del usuario', async () => {
    const state = emptyState({ conversations: [conversationRow({ title: 'T' })] });
    const { agent, captured } = makeAgent(scriptedEvents());
    const service = new AssistantService(makeDb(state), agent, LLM_CONFIG, [
      makeTool('get_heatmap'),
    ]);

    await drain(
      service.streamReply(USER, 'conv-1', {
        content: 'Háblame de este alumno',
        studentRefs: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
      }),
    );

    const lastMsg = captured.params!.messages.at(-1)!;
    const text = (lastMsg.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Háblame de este alumno');
    expect(text).toContain('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});
