import type { Database, RemedialMaterial } from '@soe/db';
import type { RemedialBriefService } from './remedial-brief.service';
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
      referenceItems: [],
    }),
  } as unknown as RemedialContextService;
}

function makeBrief(brief: unknown = null) {
  return {
    build: jest.fn().mockResolvedValue(brief),
  } as unknown as RemedialBriefService & { build: jest.Mock };
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
  it('happy path: markProcessing → brief+contexto (con orgId) → generate → markReady', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const context = makeContext() as RemedialContextService & { assemble: jest.Mock };
    const brief = makeBrief({ rootCauseHypothesis: 'rc', realErrors: [] });
    const gen = makeGenerator('guide', validResult);
    const runner = new RemedialRunner(makeDb(makeRow()), service, context, brief, [gen]);

    await runner.run('mat-1', 'org-1');

    expect(service.markProcessing).toHaveBeenCalledWith('mat-1', 'org-1');
    // assemble ahora recibe el orgId (activa el filtro de pool por org).
    expect(context.assemble).toHaveBeenCalledWith('node-1', 'org-1');
    // el brief se construye desde el material (nodeId + trazabilidad).
    expect(brief.build).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', nodeId: 'node-1' }),
    );
    // el brief se persiste en el input de auditoría.
    expect(service.markReady).toHaveBeenCalledWith(
      'mat-1',
      'org-1',
      expect.objectContaining({
        input: expect.objectContaining({ brief: { rootCauseHypothesis: 'rc', realErrors: [] } }),
      }),
    );
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it('si el generador lanza → markFailed (nunca tumba el proceso)', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const gen = makeGenerator('guide', undefined);
    (gen.generate as jest.Mock).mockRejectedValue(new Error('llm caído'));
    const runner = new RemedialRunner(makeDb(makeRow()), service, makeContext(), makeBrief(), [gen]);

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
      makeBrief(),
      [], // sin generadores
    );

    await runner.run('mat-1', 'org-1');
    expect(service.markFailed).toHaveBeenCalled();
  });

  it('si el material no existe → markFailed', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const gen = makeGenerator('guide', validResult);
    const runner = new RemedialRunner(makeDb(undefined), service, makeContext(), makeBrief(), [gen]);

    await runner.run('missing', 'org-1');
    expect(service.markFailed).toHaveBeenCalled();
    expect(service.markProcessing).not.toHaveBeenCalled();
  });
});
