import { BadRequestException } from '@nestjs/common';
import type { Database, Item, ItemEditProposal } from '@soe/db';
import type { ItemType, UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { ItemsService } from '../items/items.service';
import { LlmService } from '../llm/llm.service';
import { ItemEditProposalsService, parseLlmJson } from './item-edit-proposals.service';

// ──────────────────────────────────────────────────────────────────────────────
// TKT-19 — Tests de la escritura asistida de ítems (IA propone, humano aprueba).
// El mock de DB reentra `withOrgContext` (db.transaction(cb) => cb(tx)) con un tx
// encadenable. Verificamos: (a) parseo robusto del JSON del LLM; (b) que proponer
// NO toca el ítem; (c) que aprobar SÍ lo aplica vía ItemsService.update; (d) que
// rechazar no lo toca; (e) guard de estado.
// ──────────────────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = overrides.activeRole ?? 'eval_coordinator';
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: false,
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    orgId: 'org-1',
    instrumentId: null,
    sectionId: null,
    position: 1,
    type: 'multiple_choice' as ItemType,
    content: {
      stem: 'Enunciado original',
      alternatives: [
        { key: 'A', text: 'uno', isCorrect: true },
        { key: 'B', text: 'dos', isCorrect: false },
      ],
    },
    scoringConfig: {},
    irtParams: {},
    status: 'draft',
    version: 3,
    source: 'custom',
    createdById: 'user-1',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Item;
}

function makeProposalRow(overrides: Partial<ItemEditProposal> = {}): ItemEditProposal {
  return {
    id: 'prop-1',
    orgId: 'org-1',
    itemId: 'item-1',
    status: 'pending',
    author: 'ai',
    itemType: 'multiple_choice',
    instruction: 'mejora la redacción',
    reasoning: 'aclaré el enunciado',
    currentContent: { stem: 'Enunciado original', alternatives: [] } as never,
    proposedContent: {
      stem: 'Enunciado más claro',
      alternatives: [
        { key: 'A', text: 'uno', isCorrect: true },
        { key: 'B', text: 'dos', isCorrect: false },
      ],
    } as never,
    appliedVersion: null,
    model: 'gemini-2.0-flash',
    promptVersion: 'tkt19-item-edit-v1',
    tokens: null,
    costUsd: null,
    createdById: 'user-1',
    reviewedById: null,
    createdAt: new Date('2026-01-02T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    reviewedAt: null,
    ...overrides,
  };
}

/** tx/db encadenable. `rows` es la fuente que devuelven los select; `inserted`
 *  lo que devuelve returning(). update.set() muta `rows[0]` con el patch. */
function makeDb(state: { rows: ItemEditProposal[]; inserted?: ItemEditProposal }) {
  const makeSelect = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'offset']) {
      chain[m] = () => chain;
    }
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(state.rows).then(res, rej);
    return chain;
  };
  const db = {
    transaction: (cb: (tx: Database) => Promise<unknown>) => cb(db as unknown as Database),
    execute: async () => undefined,
    select: () => makeSelect(),
    insert: () => ({
      values: () => ({ returning: async () => [state.inserted ?? state.rows[0]] }),
    }),
    update: () => ({
      set: (patch: Partial<ItemEditProposal>) => ({
        where: async () => {
          if (state.rows[0]) Object.assign(state.rows[0], patch);
        },
      }),
    }),
  };
  return db as unknown as Database;
}

describe('parseLlmJson', () => {
  it('parsea JSON plano con content y reasoning', () => {
    const out = parseLlmJson('{"reasoning":"x","content":{"stem":"y"}}');
    expect(out).toEqual({ reasoning: 'x', content: { stem: 'y' } });
  });

  it('tolera cercas de código ```json', () => {
    const out = parseLlmJson('```json\n{"content":{"stem":"y"}}\n```');
    expect(out?.content).toEqual({ stem: 'y' });
    expect(out?.reasoning).toBeNull();
  });

  it('extrae el primer objeto aun con texto residual alrededor', () => {
    const out = parseLlmJson('Aquí tienes: {"content":{"a":1}} listo.');
    expect(out?.content).toEqual({ a: 1 });
  });

  it('devuelve null si no hay content objeto', () => {
    expect(parseLlmJson('{"reasoning":"x"}')).toBeNull();
    expect(parseLlmJson('no json')).toBeNull();
    expect(parseLlmJson('{"content":"texto"}')).toBeNull();
  });
});

describe('ItemEditProposalsService', () => {
  let items: jest.Mocked<Pick<ItemsService, 'getEditableItem' | 'update'>>;
  let llm: jest.Mocked<Pick<LlmService, 'completeWithUsage'>>;

  beforeEach(() => {
    items = {
      getEditableItem: jest.fn(async () => makeItem()),
      update: jest.fn(async () => makeItem({ version: 4 })),
    } as never;
    llm = {
      completeWithUsage: jest.fn(async () => ({
        text: '{"reasoning":"aclaré el enunciado","content":{"stem":"Enunciado más claro","alternatives":[{"key":"A","text":"uno","isCorrect":true},{"key":"B","text":"dos","isCorrect":false}]}}',
        model: 'gemini-2.0-flash',
        usage: { inputTokens: 100, outputTokens: 50 },
      })),
    } as never;
  });

  function makeService(db: Database) {
    return new ItemEditProposalsService(
      db,
      items as unknown as ItemsService,
      llm as unknown as LlmService,
    );
  }

  it('propose crea una propuesta pending y NO toca el ítem', async () => {
    const inserted = makeProposalRow();
    const db = makeDb({ rows: [inserted], inserted });
    const svc = makeService(db);

    const out = await svc.propose(
      makeUser(),
      { itemId: 'item-1', instruction: 'mejora la redacción' },
      'ai',
    );

    expect(items.getEditableItem).toHaveBeenCalledWith('item-1', expect.anything());
    expect(llm.completeWithUsage).toHaveBeenCalled();
    expect(items.update).not.toHaveBeenCalled(); // §8.3: no se aplica al proponer
    expect(out.status).toBe('pending');
  });

  it('propose falla (400) si el LLM no devuelve JSON válido', async () => {
    llm.completeWithUsage.mockResolvedValueOnce({
      text: 'lo siento, no puedo',
      model: 'gemini-2.0-flash',
      usage: null,
    } as never);
    const db = makeDb({ rows: [makeProposalRow()] });
    const svc = makeService(db);

    await expect(
      svc.propose(makeUser(), { itemId: 'item-1', instruction: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(items.update).not.toHaveBeenCalled();
  });

  it('review approve APLICA el content propuesto al ítem y marca approved', async () => {
    const row = makeProposalRow({ status: 'pending' });
    const db = makeDb({ rows: [row] });
    const svc = makeService(db);

    const out = await svc.review(makeUser(), 'prop-1', { action: 'approve' });

    expect(items.update).toHaveBeenCalledWith(
      'item-1',
      { content: row.proposedContent },
      expect.anything(),
    );
    expect(out.status).toBe('approved');
    expect(out.appliedVersion).toBe(4);
  });

  it('review reject marca rejected sin tocar el ítem', async () => {
    const db = makeDb({ rows: [makeProposalRow({ status: 'pending' })] });
    const svc = makeService(db);

    const out = await svc.review(makeUser(), 'prop-1', { action: 'reject' });

    expect(items.update).not.toHaveBeenCalled();
    expect(out.status).toBe('rejected');
  });

  it('review rechaza (400) una propuesta que no está pending', async () => {
    const db = makeDb({ rows: [makeProposalRow({ status: 'approved' })] });
    const svc = makeService(db);

    await expect(svc.review(makeUser(), 'prop-1', { action: 'approve' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
