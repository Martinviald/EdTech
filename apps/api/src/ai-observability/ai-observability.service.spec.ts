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

interface SelectCall {
  projection: Record<string, unknown> | undefined;
  groupedBy: number;
  inTransaction: boolean;
}

function selectChain(rows: unknown[], call: SelectCall) {
  const whereResult: Record<string, unknown> = {
    limit: () => Promise.resolve(rows),
    groupBy: (...columns: unknown[]) => {
      call.groupedBy = columns.length;
      return Promise.resolve(rows);
    },
    then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
  };
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => whereResult,
  };
  return chain;
}

function makeDb(selectResults: unknown[][], calls: SelectCall[] = []): Database {
  let idx = 0;
  let transactionDepth = 0;
  const db = {
    select: (projection?: Record<string, unknown>) => {
      const rows = selectResults[idx] ?? [];
      idx++;
      const call: SelectCall = { projection, groupedBy: 0, inTransaction: transactionDepth > 0 };
      calls.push(call);
      return selectChain(rows, call);
    },
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      transactionDepth++;
      try {
        return await fn(db);
      } finally {
        transactionDepth--;
      }
    },
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

/** Fila de assistant_messages (turno del asistente con costo/tokens). */
function assistantRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm-1',
    conversationId: 'c-1',
    orgId: 'org-1',
    role: 'assistant',
    content: 'respuesta',
    toolCalls: [],
    model: 'claude-sonnet-4-20250514',
    promptVersion: 'e21-assistant-v1',
    tokens: { input: 500, output: 250 },
    costUsd: '0.005250',
    createdAt: new Date('2026-06-03T10:00:00Z'),
    ...overrides,
  };
}

function gradingJobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'g-1',
    orgId: 'org-1',
    responseId: 'resp-1',
    type: 'development_crop',
    status: 'completed',
    model: 'gemini-2.5-pro',
    promptVersion: 'dev-grading-v1',
    input: {},
    output: {},
    score: '1.50',
    confidence: '0.80',
    justification: 'Respuesta casi completa',
    costUsd: '0.002250',
    createdAt: new Date('2026-06-04T10:00:00Z'),
    completedAt: new Date('2026-06-04T10:00:03Z'),
    ...overrides,
  };
}

function answerReadingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ar-1',
    orgId: 'org-1',
    mode: 'primary',
    status: 'ok',
    model: 'claude-haiku-5-5',
    inputTokens: 600,
    outputTokens: 300,
    costUsd: '0.000210',
    latencyMs: 900,
    createdAt: new Date('2026-06-05T10:00:00Z'),
    ...overrides,
  };
}

function decisionBucketRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    feature: 'mark_disambiguation_jev',
    model: 'jev-1.14.0',
    status: 'ok',
    day: '2026-06-05',
    calls: 3,
    costUsd: '0.000400',
    inputTokens: '1200',
    outputTokens: '60',
    latencySumMs: '2100',
    latencyCount: 3,
    ...overrides,
  };
}

describe('AiObservabilityService', () => {
  describe('getSummary — llamadas del motor de decisiones (decision_calls)', () => {
    it('pondera cada grupo agregado por su número de llamadas y lo agrupa por feature', async () => {
      const db = makeDb([
        [],
        [],
        [],
        [],
        [],
        [
          decisionBucketRow(),
          decisionBucketRow({
            feature: 'remedial_judge',
            model: 'gpt-6-luna',
            status: 'error',
            calls: 2,
            costUsd: null,
            inputTokens: '0',
            outputTokens: '0',
            latencySumMs: null,
            latencyCount: 0,
          }),
        ],
      ]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser());

      const bucket = result.bySource.find((b) => b.key === 'decision');
      expect(bucket?.count).toBe(5);
      expect(bucket?.totalCostUsd).toBeCloseTo(0.0004, 6);
      expect(bucket?.inputTokens).toBe(1200);
      expect(bucket?.outputTokens).toBe(60);
      expect(bucket?.avgLatencyMs).toBe(700);
      expect(result.totals.count).toBe(5);
      expect(result.totals.failedCount).toBe(2);
      expect(result.byType.map((b) => b.key).sort()).toEqual([
        'decision:mark_disambiguation_jev',
        'decision:remedial_judge',
      ]);
    });

    it('agrega decision_calls en SQL dentro del contexto de la org, sin leer los JSONB', async () => {
      const calls: SelectCall[] = [];
      const db = makeDb([[], [], [], [], [], [decisionBucketRow()]], calls);
      const service = makeService(db);

      await service.getSummary(makeUser());

      const decisionCall = calls[5];
      expect(decisionCall?.inTransaction).toBe(true);
      expect(decisionCall?.groupedBy).toBe(4);
      expect(Object.keys(decisionCall?.projection ?? {}).sort()).toEqual([
        'calls',
        'costUsd',
        'day',
        'feature',
        'inputTokens',
        'latencyCount',
        'latencySumMs',
        'model',
        'outputTokens',
        'status',
      ]);
    });

    it('el gasto de decision_calls entra en el presupuesto del mes', async () => {
      const db = makeDb([
        [],
        [],
        [],
        [],
        [],
        [
          decisionBucketRow({ costUsd: '40' }),
          decisionBucketRow({ status: 'error', costUsd: '2.5' }),
        ],
        [{ config: { aiBudgetUsd: 100 } }],
      ]);
      const service = makeService(db);

      const result = await service.getBudget(makeUser());

      expect(result.monthSpendUsd).toBeCloseTo(42.5, 6);
      expect(result.pctUsed).toBeCloseTo(42.5, 2);
    });

    it('cada grupo diario de decision_calls cae en su día de la serie', async () => {
      const db = makeDb([
        [analysisRow({ createdAt: new Date('2026-06-05T08:00:00Z'), costUsd: '0.01' })],
        [],
        [],
        [],
        [],
        [decisionBucketRow({ day: '2026-06-05', costUsd: '0.02' })],
      ]);
      const service = makeService(db);

      const result = await service.getTimeseries(makeUser(), '2026-06-01', '2026-06-30');

      expect(result.points).toEqual([{ date: '2026-06-05', costUsd: 0.03, count: 4 }]);
    });
  });

  describe('getSummary — lectura de respuestas escritas (answer_readings)', () => {
    it('suma el costo, los tokens y la latencia de las lecturas por visión', async () => {
      const db = makeDb([
        [],
        [],
        [],
        [],
        [
          answerReadingRow(),
          answerReadingRow({
            id: 'ar-2',
            mode: 'shadow',
            status: 'timeout',
            costUsd: '0',
            latencyMs: 30000,
          }),
        ],
      ]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser(), '2026-06-01', '2026-06-30');

      expect(result.totals).toMatchObject({
        count: 2,
        inputTokens: 1200,
        outputTokens: 600,
        failedCount: 1,
      });
      expect(result.totals.totalCostUsd).toBeCloseTo(0.00021, 6);
      const bucket = result.bySource.find((b) => b.key === 'answer_reading');
      expect(bucket).toMatchObject({ label: 'Lectura de respuestas escritas', count: 2 });
      expect(result.byType.find((b) => b.key === 'answer_reading:shadow')?.label).toBe(
        'Lectura en sombra',
      );
    });

    it('incluye las lecturas en el gasto del mes', async () => {
      const db = makeDb([[], [], [], [], [answerReadingRow({ costUsd: '0.5' })]]);
      const service = makeService(db);

      await expect(service.monthSpendUsd('org-1', new Date())).resolves.toBeCloseTo(0.5, 6);
    });
  });

  describe('getSummary — corrección IA (ai_grading_jobs)', () => {
    it('suma el costo de las correcciones IA en totals, bySource y byType', async () => {
      const db = makeDb([[analysisRow()], [], [], [gradingJobRow(), gradingJobRow({ id: 'g-2' })]]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser(), '2026-06-01', '2026-06-30');

      expect(result.totals.count).toBe(3);
      expect(result.totals.totalCostUsd).toBeCloseTo(0.012345 + 0.0045, 6);
      const gradingBucket = result.bySource.find((b) => b.key === 'ai_grading');
      expect(gradingBucket).toMatchObject({ label: 'Corrección IA', count: 2, avgLatencyMs: 3000 });
      expect(gradingBucket?.totalCostUsd).toBeCloseTo(0.0045, 6);
      const typeBucket = result.byType.find((b) => b.key === 'ai_grading:development_crop');
      expect(typeBucket?.label).toBe('Corrección de respuestas de desarrollo');
    });

    it('cuenta como fallidas las correcciones con status failed y sin costo', async () => {
      const db = makeDb([
        [],
        [],
        [],
        [gradingJobRow({ status: 'failed', costUsd: null, completedAt: null })],
      ]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser(), '2026-06-01', '2026-06-30');

      expect(result.totals.failedCount).toBe(1);
      expect(result.totals.totalCostUsd).toBe(0);
      expect(result.totals.avgLatencyMs).toBeNull();
    });

    it('incluye las correcciones IA en el gasto del mes', async () => {
      const db = makeDb([
        [],
        [],
        [],
        [gradingJobRow({ costUsd: '90' })],
        [],
        [],
        [{ config: { aiBudgetUsd: 100 } }],
      ]);
      const service = makeService(db);

      const result = await service.getBudget(makeUser());

      expect(result.monthSpendUsd).toBeCloseTo(90, 6);
      expect(result.alertLevel).toBe('warning');
    });
  });

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

    it('incluye los turnos del asistente (source assistant) en totals y bySource', async () => {
      const db = makeDb([[analysisRow()], [remedialRow()], [assistantRow()]]);
      const service = makeService(db);

      const result = await service.getSummary(makeUser());

      expect(result.totals.count).toBe(3);
      expect(result.totals.totalCostUsd).toBeCloseTo(0.047595, 6);
      expect(result.totals.inputTokens).toBe(3500);
      expect(result.totals.outputTokens).toBe(1550);

      const sources = result.bySource.map((b) => b.key).sort();
      expect(sources).toEqual(['ai_analysis', 'assistant', 'remedial']);
      const assistantBucket = result.bySource.find((b) => b.key === 'assistant');
      expect(assistantBucket?.label).toBe('Asistente IA');
      expect(assistantBucket?.count).toBe(1);
      expect(assistantBucket?.totalCostUsd).toBeCloseTo(0.00525, 6);
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
      const db = makeDb([[analysisRow({ costUsd: '0.50' })], [], [], [], [], [], [{ config: {} }]]);
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
        [],
        [],
        [],
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
        [],
        [],
        [],
        [],
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
