import { DEFAULT_ORG_ANSWER_READING_SETTINGS } from '@soe/types';
import type { AiObservabilityService } from '../ai-observability/ai-observability.service';
import type { Database } from '../database/database.types';
import { AnswerReadingBudgetService } from './answer-reading-budget.service';
import { DEFAULT_ANSWER_READING_OPTIONS } from './answer-reading.constants';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function makeDb(statsRow: Record<string, unknown>): Database {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve([statsRow]),
  };
  const db = {
    select: () => chain,
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  };
  return db as unknown as Database;
}

function makeService(statsRow: Record<string, unknown>, monthSpendUsd = 0) {
  const monthSpend = jest.fn().mockResolvedValue(monthSpendUsd);
  const observability = { monthSpendUsd: monthSpend } as unknown as AiObservabilityService;
  const service = new AnswerReadingBudgetService(
    makeDb(statsRow),
    observability,
    DEFAULT_ANSWER_READING_OPTIONS,
  );
  return { service, monthSpend };
}

const SETTINGS = { ...DEFAULT_ORG_ANSWER_READING_SETTINGS };

describe('AnswerReadingBudgetService.isExceeded', () => {
  it('sin presupuestos configurados nunca bloquea', async () => {
    const { service, monthSpend } = makeService({ monthSpendUsd: '999', averageCostUsd: '1' });

    await expect(
      service.isExceeded({ orgId: ORG_ID, orgConfig: {}, settings: SETTINGS, plannedReadings: 10 }),
    ).resolves.toBe(false);
    expect(monthSpend).not.toHaveBeenCalled();
  });

  it('bloquea si el gasto de lectura del mes más la estimación supera el presupuesto propio', async () => {
    const { service } = makeService({ monthSpendUsd: '0.95', averageCostUsd: '0.01' });

    const exceeded = await service.isExceeded({
      orgId: ORG_ID,
      orgConfig: {},
      settings: { ...SETTINGS, monthlyBudgetUsd: 1 },
      plannedReadings: 10,
    });

    expect(exceeded).toBe(true);
  });

  it('usa el costo medio por defecto cuando no hay historia y no bloquea si alcanza', async () => {
    const { service } = makeService({ monthSpendUsd: '0', averageCostUsd: null });

    const exceeded = await service.isExceeded({
      orgId: ORG_ID,
      orgConfig: {},
      settings: { ...SETTINGS, monthlyBudgetUsd: 1 },
      plannedReadings: 10,
    });

    expect(exceeded).toBe(false);
  });

  it('bloquea si el gasto IA total del mes más la estimación supera aiBudgetUsd', async () => {
    const { service, monthSpend } = makeService({ monthSpendUsd: '0', averageCostUsd: '0.5' }, 9.5);

    const exceeded = await service.isExceeded({
      orgId: ORG_ID,
      orgConfig: { aiBudgetUsd: 10 },
      settings: SETTINGS,
      plannedReadings: 2,
    });

    expect(exceeded).toBe(true);
    expect(monthSpend).toHaveBeenCalledWith(ORG_ID, expect.any(Date));
  });

  it('sin lecturas planificadas no consulta el gasto', async () => {
    const { service, monthSpend } = makeService({ monthSpendUsd: '0', averageCostUsd: null });

    await expect(
      service.isExceeded({
        orgId: ORG_ID,
        orgConfig: { aiBudgetUsd: 1 },
        settings: SETTINGS,
        plannedReadings: 0,
      }),
    ).resolves.toBe(false);
    expect(monthSpend).not.toHaveBeenCalled();
  });
});
