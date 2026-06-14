import type { Database, RemedialMaterial } from '@soe/db';
import type { RemedialContextService } from './remedial-context.service';
import type { RemedialService } from './remedial.service';
import type { RemedialGenerator } from './remedial.generator';
import { RemedialRunner } from './remedial.runner';

function makeRow(overrides: Partial<RemedialMaterial> = {}): RemedialMaterial {
  return { id: 'mat-1', orgId: 'org-1', type: 'guide', nodeId: 'node-1', ...overrides } as RemedialMaterial;
}

function makeDb(row: RemedialMaterial | undefined): Database {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(row ? [row] : []),
  };
  const db = {
    select: () => chain,
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  } as unknown as Database;
  return db;
}

function makeService() {
  return {
    markProcessing: jest.fn().mockResolvedValue(undefined),
    markReady: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  } as unknown as RemedialService & {
    markProcessing: jest.Mock;
    markReady: jest.Mock;
    markFailed: jest.Mock;
  };
}

function makeContext() {
  return {
    assemble: jest.fn().mockResolvedValue({
      nodeId: 'node-1',
      target: { code: null, name: 'OA', description: null, type: 'lo' },
      ancestors: [],
      descriptors: [],
      siblings: [],
      fewShotItems: [],
    }),
  } as unknown as RemedialContextService;
}

function makeGenerator(type: RemedialGenerator['type'], result: unknown): RemedialGenerator {
  return {
    type,
    generate: jest.fn().mockResolvedValue(result),
  } as unknown as RemedialGenerator;
}

const validResult = {
  content: {
    objective: 'o',
    rootCauseSummary: 'r',
    strategy: 's',
    classActivities: [{ title: 't', description: 'd', durationMin: null }],
    materials: [],
    successCriteria: [],
  },
  promptVersion: 's3-guide-v1',
  audit: { curriculum: {} },
};

describe('RemedialRunner', () => {
  it('happy path: markProcessing → generate → markReady', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const gen = makeGenerator('guide', validResult);
    const runner = new RemedialRunner(makeDb(makeRow()), service, makeContext(), [gen]);

    await runner.run('mat-1', 'org-1');

    expect(service.markProcessing).toHaveBeenCalledWith('mat-1', 'org-1');
    expect(service.markReady).toHaveBeenCalled();
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it('si el generador lanza → markFailed (nunca tumba el proceso)', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const gen = makeGenerator('guide', undefined);
    (gen.generate as jest.Mock).mockRejectedValue(new Error('llm caído'));
    const runner = new RemedialRunner(makeDb(makeRow()), service, makeContext(), [gen]);

    await runner.run('mat-1', 'org-1');

    expect(service.markFailed).toHaveBeenCalledWith('mat-1', 'org-1', 'llm caído');
    expect(service.markReady).not.toHaveBeenCalled();
  });

  it('si no hay generador para el tipo → markFailed', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const runner = new RemedialRunner(
      makeDb(makeRow({ type: 'group_plan' })),
      service,
      makeContext(),
      [], // sin generadores
    );

    await runner.run('mat-1', 'org-1');
    expect(service.markFailed).toHaveBeenCalled();
  });

  it('si el material no existe → markFailed', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const gen = makeGenerator('guide', validResult);
    const runner = new RemedialRunner(makeDb(undefined), service, makeContext(), [gen]);

    await runner.run('missing', 'org-1');
    expect(service.markFailed).toHaveBeenCalled();
    expect(service.markProcessing).not.toHaveBeenCalled();
  });
});
