import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { UserRole } from '@soe/types';
import { LlmService } from '../llm/llm.service';
import { AiAnalysisService } from './ai-analysis.service';
import { AiAnalysisRunner } from './ai-analysis.runner';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de mock (patrón de assessment-results.service.spec.ts).
//
// El service usa select(...).from(...).where(...).orderBy(...).limit(),
// insert(...).values(...).returning() y update(...).set(...).where(). Cada uno
// corre dentro de withOrgContext, que abre una transacción (db.transaction) y
// ejecuta set_config vía tx.execute. El mock provee execute como no-op y
// transaction que reentra el mismo db.
// ──────────────────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role: UserRole = overrides.activeRole ?? overrides.role ?? 'school_admin';
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 't@x.cl',
    name: 'Tester',
    isPlatformAdmin: role === 'platform_admin',
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
  };
}

type SelectChain = {
  from: (..._: unknown[]) => SelectChain;
  where: (..._: unknown[]) => SelectChain;
  orderBy: (..._: unknown[]) => SelectChain;
  limit: (..._: unknown[]) => Promise<unknown[]>;
};

type UpdateChain = {
  set: (values: Record<string, unknown>) => { where: (..._: unknown[]) => Promise<unknown> };
};

type InsertChain = {
  values: (row: Record<string, unknown>) => { returning: () => Promise<unknown[]> };
};

type DbMock = Database & {
  __selectResults: unknown[][];
  __inserted: Array<Record<string, unknown>>;
  __updates: Array<Record<string, unknown>>;
};

function makeDb(selectResults: unknown[][], insertReturning: unknown[][] = []): DbMock {
  let selectIdx = 0;
  let insertIdx = 0;
  const inserted: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];

  const db = {
    select: (): SelectChain => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      const chain: SelectChain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(rows),
      };
      return chain;
    },
    insert: (): InsertChain => ({
      values: (row) => {
        inserted.push(row);
        const ret = insertReturning[insertIdx] ?? [{ ...row, id: 'new-id' }];
        insertIdx++;
        return { returning: () => Promise.resolve(ret) };
      },
    }),
    update: (): UpdateChain => ({
      set: (values) => {
        updates.push(values);
        return { where: () => Promise.resolve({}) };
      },
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    __selectResults: selectResults,
    __inserted: inserted,
    __updates: updates,
  } as unknown as DbMock;

  return db;
}

function makeService(db: Database): AiAnalysisService {
  return new (AiAnalysisService as new (db: Database) => AiAnalysisService)(db);
}

function baseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    orgId: 'org-1',
    assessmentId: 'as-1',
    classGroupId: null,
    analysisType: 'assessment_insights',
    audience: 'general',
    status: 'completed',
    model: 'gemini',
    promptVersion: 's0-baseline-v1',
    inputHash: 'hash',
    input: null,
    output: { summary: 'ok' },
    tokens: null,
    costUsd: null,
    error: null,
    createdById: 'user-1',
    startedAt: new Date('2025-01-01T00:00:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
    completedAt: new Date('2025-01-01T00:05:00Z'),
    updatedAt: new Date('2025-01-01T00:05:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// create()
// ──────────────────────────────────────────────────────────────────────────────

describe('AiAnalysisService.create', () => {
  it('inserta una fila pending cuando no hay caché', async () => {
    const db = makeDb(
      [[]], // cache lookup vacío
      [[baseRow({ id: 'new-1', status: 'pending', output: null })]],
    );
    const svc = makeService(db);
    const res = await svc.create(makeUser(), 'as-1', {
      analysisType: 'assessment_insights',
      audience: 'general',
      force: false,
    });
    expect(res.fromCache).toBe(false);
    expect(res.analysis.status).toBe('pending');
    expect(db.__inserted).toHaveLength(1);
    expect(db.__inserted[0]!.status).toBe('pending');
  });

  it('toma el orgId del token, nunca del body (multi-tenancy)', async () => {
    const db = makeDb([[]], [[baseRow({ id: 'new-1', status: 'pending' })]]);
    const svc = makeService(db);
    await svc.create(makeUser({ orgId: 'org-TOKEN' }), 'as-1', {
      analysisType: 'assessment_insights',
      audience: 'general',
      force: false,
    });
    expect(db.__inserted[0]!.orgId).toBe('org-TOKEN');
    expect(db.__inserted[0]!.createdById).toBe('user-1');
  });

  it('devuelve la fila existente (caché) cuando hay una completed con el mismo hash', async () => {
    const db = makeDb([[baseRow({ id: 'cached-1', status: 'completed' })]]);
    const svc = makeService(db);
    const res = await svc.create(makeUser(), 'as-1', {
      analysisType: 'assessment_insights',
      audience: 'general',
      force: false,
    });
    expect(res.fromCache).toBe(true);
    expect(res.analysis.id).toBe('cached-1');
    expect(db.__inserted).toHaveLength(0); // no inserta
  });

  it('con force=true ignora la caché e inserta de nuevo', async () => {
    const db = makeDb(
      [], // con force no hace lookup
      [[baseRow({ id: 'new-2', status: 'pending' })]],
    );
    const svc = makeService(db);
    const res = await svc.create(makeUser(), 'as-1', {
      analysisType: 'assessment_insights',
      audience: 'general',
      force: true,
    });
    expect(res.fromCache).toBe(false);
    expect(db.__inserted).toHaveLength(1);
  });

  it('lazy stale recovery: una fila processing obsoleta NO sirve como caché → regenera', async () => {
    const stale = baseRow({
      id: 'stale-1',
      status: 'processing',
      startedAt: new Date(Date.now() - 60 * 60_000), // 60 min atrás
    });
    const db = makeDb([[stale]], [[baseRow({ id: 'new-3', status: 'pending' })]]);
    const svc = makeService(db);
    const res = await svc.create(makeUser(), 'as-1', {
      analysisType: 'assessment_insights',
      audience: 'general',
      force: false,
    });
    expect(res.fromCache).toBe(false);
    expect(db.__inserted).toHaveLength(1);
  });

  it('una fila processing reciente sí bloquea regeneración (sirve como caché)', async () => {
    const fresh = baseRow({
      id: 'fresh-1',
      status: 'processing',
      output: null,
      startedAt: new Date(), // recién iniciada
    });
    const db = makeDb([[fresh]]);
    const svc = makeService(db);
    const res = await svc.create(makeUser(), 'as-1', {
      analysisType: 'assessment_insights',
      audience: 'general',
      force: false,
    });
    expect(res.fromCache).toBe(true);
    expect(res.analysis.id).toBe('fresh-1');
    expect(db.__inserted).toHaveLength(0);
  });

  it('lanza ForbiddenException si el usuario no tiene org activa', async () => {
    const db = makeDb([[]]);
    const svc = makeService(db);
    await expect(
      svc.create(makeUser({ orgId: null }), 'as-1', {
        analysisType: 'assessment_insights',
        audience: 'general',
        force: false,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// get()
// ──────────────────────────────────────────────────────────────────────────────

describe('AiAnalysisService.get', () => {
  it('devuelve el AiAnalysisModel del registro', async () => {
    const db = makeDb([[baseRow({ id: 'a-9' })]]);
    const svc = makeService(db);
    const model = await svc.get(makeUser(), 'a-9');
    expect(model.id).toBe('a-9');
    expect(model.status).toBe('completed');
    expect(typeof model.createdAt).toBe('string'); // serializado a ISO
    expect(model.output).toEqual({ summary: 'ok' });
  });

  it('lanza NotFoundException si no existe en el tenant', async () => {
    const db = makeDb([[]]);
    const svc = makeService(db);
    await expect(svc.get(makeUser(), 'missing')).rejects.toThrow(NotFoundException);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// markProcessing / markCompleted / markFailed
// ──────────────────────────────────────────────────────────────────────────────

describe('AiAnalysisService status transitions', () => {
  it('markProcessing setea status=processing y startedAt', async () => {
    const db = makeDb([]);
    const svc = makeService(db);
    await svc.markProcessing('a-1', 'org-1');
    expect(db.__updates).toHaveLength(1);
    expect(db.__updates[0]!.status).toBe('processing');
    expect(db.__updates[0]!.startedAt).toBeInstanceOf(Date);
  });

  it('markCompleted guarda output/model/cost y limpia error', async () => {
    const db = makeDb([]);
    const svc = makeService(db);
    await svc.markCompleted('a-1', 'org-1', {
      output: { summary: 'listo' },
      model: 'gemini',
      promptVersion: 'v1',
      tokens: { input: 10, output: 5 },
      costUsd: '0.000123',
    });
    expect(db.__updates[0]!.status).toBe('completed');
    expect(db.__updates[0]!.output).toEqual({ summary: 'listo' });
    expect(db.__updates[0]!.error).toBeNull();
  });

  it('markFailed setea status=failed con el error', async () => {
    const db = makeDb([]);
    const svc = makeService(db);
    await svc.markFailed('a-1', 'org-1', 'boom');
    expect(db.__updates[0]!.status).toBe('failed');
    expect(db.__updates[0]!.error).toBe('boom');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AiAnalysisRunner
// ──────────────────────────────────────────────────────────────────────────────

function makeRunner(
  llmComplete: () => Promise<string>,
): {
  runner: AiAnalysisRunner;
  markProcessing: jest.Mock;
  markCompleted: jest.Mock;
  markFailed: jest.Mock;
} {
  const db = makeDb([[baseRow({ id: 'a-1', status: 'pending' })]]);
  const llm = { complete: jest.fn(llmComplete) } as unknown as LlmService;
  const markProcessing = jest.fn().mockResolvedValue(undefined);
  const markCompleted = jest.fn().mockResolvedValue(undefined);
  const markFailed = jest.fn().mockResolvedValue(undefined);
  const service = { markProcessing, markCompleted, markFailed } as unknown as AiAnalysisService;
  const runner = new (AiAnalysisRunner as new (
    db: Database,
    llm: LlmService,
    service: AiAnalysisService,
  ) => AiAnalysisRunner)(db, llm, service);
  return { runner, markProcessing, markCompleted, markFailed };
}

describe('AiAnalysisRunner.run', () => {
  it('happy path: parsea la salida del LLM y marca completed con output', async () => {
    const { runner, markProcessing, markCompleted, markFailed } = makeRunner(async () =>
      JSON.stringify({ summary: 'Resumen pedagógico' }),
    );
    await runner.run('a-1', 'org-1');
    expect(markProcessing).toHaveBeenCalledWith('a-1', 'org-1');
    expect(markCompleted).toHaveBeenCalledTimes(1);
    const arg = markCompleted.mock.calls[0]![2] as { output: Record<string, unknown> };
    expect(arg.output).toEqual({ summary: 'Resumen pedagógico' });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('tolera fences ```json alrededor del JSON', async () => {
    const { runner, markCompleted } = makeRunner(async () =>
      '```json\n{"summary":"ok"}\n```',
    );
    await runner.run('a-1', 'org-1');
    expect(markCompleted).toHaveBeenCalledTimes(1);
  });

  it('salida no parseable (no JSON) → markFailed', async () => {
    const { runner, markCompleted, markFailed } = makeRunner(async () => 'esto no es json');
    await runner.run('a-1', 'org-1');
    expect(markCompleted).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
  });

  it('JSON válido pero que no cumple el schema → markFailed', async () => {
    const { runner, markCompleted, markFailed } = makeRunner(async () =>
      JSON.stringify({ noSummary: true }),
    );
    await runner.run('a-1', 'org-1');
    expect(markCompleted).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
  });

  it('error del LLM → markFailed (no tumba el proceso)', async () => {
    const { runner, markFailed } = makeRunner(async () => {
      throw new Error('llm down');
    });
    await runner.run('a-1', 'org-1');
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('llm down');
  });
});
