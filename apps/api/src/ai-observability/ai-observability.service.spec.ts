import { ForbiddenException } from '@nestjs/common';
import type { Database } from '@soe/db';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { AiObservabilityService } from './ai-observability.service';

// ──────────────────────────────────────────────────────────────────────────────
// El service lee filas crudas de ai_analyses y remedial_materials dentro de
// withOrgContext (select().from().where() → promesa de filas) y la config de la
// org con this.db (select().from().where().limit()). El mock devuelve los
// resultados de cada select() en orden y soporta ambas formas de terminar la
// cadena (await sobre .where() o sobre .where().limit()).
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

/** Cadena de select() que resuelve `rows` tanto en .where() como en .limit(). */
function selectChain(rows: unknown[]) {
  const whereResult: Record<string, unknown> = {
    limit: () => Promise.resolve(rows),
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => whereResult,
  };
  return chain;
}

function makeDb(selectResults: unknown[][]): Database {
  let idx = 0;
  const db = {
    select: () => {
      const rows = selectResults[idx] ?? [];
      idx++;
      return selectChain(rows);
    },
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  } as unknown as Database;
  return db;
}

function makeService(db: Database): AiObservabilityService {
  return new (AiObservabilityService as new (db: Database) => AiObservabilityService)(db);
}

function analysisRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    orgId: 'org-1',
    analysisType: 'assessment_insights',
    audience: 'general',
    status: 'completed',
    model: 'gemini-2.0-flash',
    tokens: { input: 1000, output: 500 },
    costUsd: '0.012345',
    error: null,
    startedAt: new Date('2026-06-01T10:00:00Z'),
    completedAt: new Date('2026-06-01T10:00:02Z'),
    createdAt: new Date('2026-06-01T10:00:00Z'),
    updatedAt: new Date('2026-06-01T10:00:02Z'),
    deletedAt: null,
    ...overrides,
  };
}

function remedialRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r-1',
    orgId: 'org-1',
    type: 'guide',
    status: 'ready',
    model: 'gemini-2.0-flash',
    tokens: { input: 2000, output: 800 },
    costUsd: '0.030000',
    error: null,
    startedAt: new Date('2026-06-02T10:00:00Z'),
    completedAt: new Date('2026-06-02T10:00:05Z'),
    createdAt: new Date('2026-06-02T10:00:00Z'),
    updatedAt: new Date('2026-06-02T10:00:05Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('AiObservabilityService', () => {
  describe('getSummary — agregación de costo y tokens', () => {
    it('agrega costo y tokens de ambas tablas en totals', async () => {
      const db = makeDb([[analysisRow()], [remedialRow()]]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser());

      expect(result.orgId).toBe('org-1');
      expect(result.totals.count).toBe(2);
      expect(result.totals.totalCostUsd).toBeCloseTo(0.042345, 6);
      expect(result.totals.inputTokens).toBe(3000);
      expect(result.totals.outputTokens).toBe(1300);
      expect(result.totals.failedCount).toBe(0);
    });

    it('trata costUsd null y tokens null como 0', async () => {
      const db = makeDb([[analysisRow({ costUsd: null, tokens: null })], []]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser());

      expect(result.totals.totalCostUsd).toBe(0);
      expect(result.totals.inputTokens).toBe(0);
      expect(result.totals.outputTokens).toBe(0);
    });
  });

  describe('getSummary — avgLatencyMs', () => {
    it('promedia la latencia sólo de filas completadas con ambos timestamps', async () => {
      const db = makeDb([
        [
          analysisRow({
            startedAt: new Date('2026-06-01T10:00:00Z'),
            completedAt: new Date('2026-06-01T10:00:04Z'), // 4000ms
          }),
        ],
        [
          remedialRow({
            startedAt: new Date('2026-06-02T10:00:00Z'),
            completedAt: new Date('2026-06-02T10:00:06Z'), // 6000ms
          }),
        ],
      ]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser());

      expect(result.totals.avgLatencyMs).toBe(5000);
    });

    it('devuelve avgLatencyMs null cuando faltan timestamps o no está completado', async () => {
      const db = makeDb([
        [analysisRow({ status: 'pending', startedAt: null, completedAt: null })],
        [remedialRow({ status: 'failed', completedAt: null })],
      ]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser());

      expect(result.totals.avgLatencyMs).toBeNull();
    });
  });

  describe('getSummary — desgloses', () => {
    it('agrupa por source, type y model', async () => {
      const db = makeDb([
        [
          analysisRow({ id: 'a-1', analysisType: 'assessment_insights', costUsd: '0.01' }),
          analysisRow({ id: 'a-2', analysisType: 'skill_gaps', costUsd: '0.02' }),
        ],
        [remedialRow({ id: 'r-1', type: 'guide', model: null, costUsd: '0.05' })],
      ]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser());

      // bySource: 2 orígenes
      const sources = result.bySource.map((b) => b.key).sort();
      expect(sources).toEqual(['ai_analysis', 'remedial']);
      const analysisBucket = result.bySource.find((b) => b.key === 'ai_analysis');
      expect(analysisBucket?.count).toBe(2);
      expect(analysisBucket?.totalCostUsd).toBeCloseTo(0.03, 6);

      // byType: 3 tipos distintos (2 análisis + 1 remedial)
      expect(result.byType).toHaveLength(3);

      // byModel: gemini + desconocido
      const modelKeys = result.byModel.map((b) => b.key).sort();
      expect(modelKeys).toEqual(['gemini-2.0-flash', 'unknown']);
      const unknown = result.byModel.find((b) => b.key === 'unknown');
      expect(unknown?.label).toBe('desconocido');
    });
  });

  describe('getSummary — failedCount y rango por default', () => {
    it('cuenta filas con status failed en ambas tablas', async () => {
      const db = makeDb([
        [analysisRow({ status: 'failed' }), analysisRow({ id: 'a-2', status: 'completed' })],
        [remedialRow({ status: 'failed' })],
      ]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser());

      expect(result.totals.failedCount).toBe(2);
    });

    it('usa un rango de 30 días por default (from/to ausentes)', async () => {
      const db = makeDb([[], []]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser());

      const from = new Date(`${result.from}T00:00:00Z`);
      const to = new Date(`${result.to}T00:00:00Z`);
      const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
      expect(days).toBe(29); // hoy + 29 días previos
    });
  });

  describe('getBudget', () => {
    it('sin tope (config sin aiBudgetUsd) → budgetUsd null, pctUsed null, alertLevel ok', async () => {
      const db = makeDb([[analysisRow({ costUsd: '0.50' })], [], [{ config: {} }]]);
      const service = makeService(db);

      const result = await service.getBudget(makeUser());

      expect(result.monthSpendUsd).toBeCloseTo(0.5, 6);
      expect(result.budgetUsd).toBeNull();
      expect(result.pctUsed).toBeNull();
      expect(result.alertLevel).toBe('ok');
      expect(result.month).toMatch(/^\d{4}-\d{2}$/);
    });

    it('gasto en zona warning (80-100%) → alertLevel warning', async () => {
      const db = makeDb([
        [analysisRow({ costUsd: '85' })],
        [],
        [{ config: { aiBudgetUsd: 100 } }],
      ]);
      const service = makeService(db);

      const result = await service.getBudget(makeUser());

      expect(result.budgetUsd).toBe(100);
      expect(result.pctUsed).toBeCloseTo(85, 2);
      expect(result.alertLevel).toBe('warning');
    });

    it('gasto sobre el tope (>100%) → alertLevel over', async () => {
      const db = makeDb([
        [analysisRow({ costUsd: '60' })],
        [remedialRow({ costUsd: '60' })],
        [{ config: { aiBudgetUsd: 100 } }],
      ]);
      const service = makeService(db);

      const result = await service.getBudget(makeUser());

      expect(result.monthSpendUsd).toBeCloseTo(120, 6);
      expect(result.pctUsed).toBeCloseTo(120, 2);
      expect(result.alertLevel).toBe('over');
    });
  });

  describe('getTimeseries', () => {
    it('agrupa el gasto por día (YYYY-MM-DD), ordenado', async () => {
      const db = makeDb([
        [
          analysisRow({ createdAt: new Date('2026-06-02T08:00:00Z'), costUsd: '0.02' }),
          analysisRow({ id: 'a-2', createdAt: new Date('2026-06-01T08:00:00Z'), costUsd: '0.01' }),
        ],
        [remedialRow({ createdAt: new Date('2026-06-02T20:00:00Z'), costUsd: '0.03' })],
      ]);
      const service = makeService(db);

      const result = await service.getTimeseries(makeUser(), '2026-06-01', '2026-06-30');

      expect(result.points).toHaveLength(2);
      expect(result.points[0]).toEqual({ date: '2026-06-01', costUsd: 0.01, count: 1 });
      expect(result.points[1]).toEqual({ date: '2026-06-02', costUsd: 0.05, count: 2 });
    });
  });

  describe('multi-tenancy', () => {
    it('lanza ForbiddenException si el usuario no tiene org activa', async () => {
      const db = makeDb([]);
      const service = makeService(db);

      await expect(service.getSummary(makeUser({ orgId: null }))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
