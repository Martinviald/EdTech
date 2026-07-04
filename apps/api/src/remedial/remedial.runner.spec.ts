import { NotFoundException } from '@nestjs/common';
import type { Database, RemedialMaterial } from '@soe/db';
import type { RemedialBriefService } from './remedial-brief.service';
import type { RemedialContextService } from './remedial-context.service';
import type { RemedialService } from './remedial.service';
import type { RemedialGenerator } from './remedial.generator';
import type { ResolvedStimulus, StimulusResolver } from './stimulus/stimulus.resolver';
import { RemedialRunner } from './remedial.runner';

function makeRow(overrides: Partial<RemedialMaterial> = {}): RemedialMaterial {
  return {
    id: 'mat-1',
    orgId: 'org-1',
    type: 'guide',
    method: 'self_contained',
    nodeId: 'node-1',
    assessmentId: null,
    input: null,
    ...overrides,
  } as RemedialMaterial;
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

function makeResolver(
  resolved: ResolvedStimulus = { method: 'self_contained', stimulus: null },
) {
  return {
    resolve: jest.fn().mockResolvedValue(resolved),
  } as unknown as StimulusResolver & { resolve: jest.Mock };
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
  it('happy path: markProcessing → brief+contexto+estímulo (con orgId) → generate → markReady', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const context = makeContext() as RemedialContextService & { assemble: jest.Mock };
    const brief = makeBrief({ rootCauseHypothesis: 'rc', realErrors: [] });
    const resolver = makeResolver();
    const gen = makeGenerator('guide', validResult);
    const runner = new RemedialRunner(makeDb(makeRow()), service, context, brief, resolver, [gen]);

    await runner.run('mat-1', 'org-1');

    expect(service.markProcessing).toHaveBeenCalledWith('mat-1', 'org-1');
    // assemble ahora recibe el orgId (activa el filtro de pool por org).
    expect(context.assemble).toHaveBeenCalledWith('node-1', 'org-1');
    // el brief se construye desde el material (nodeId + trazabilidad).
    expect(brief.build).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', nodeId: 'node-1' }),
    );
    // el estímulo se resuelve con el método/nodo del registro (default self_contained).
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', nodeId: 'node-1', method: 'self_contained' }),
    );
    // el brief se persiste en el input de auditoría + el método EFECTIVO resuelto.
    expect(service.markReady).toHaveBeenCalledWith(
      'mat-1',
      'org-1',
      expect.objectContaining({
        method: 'self_contained',
        input: expect.objectContaining({ brief: { rootCauseHypothesis: 'rc', realErrors: [] } }),
      }),
    );
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it('modo estímulo: resuelve reuse_stimulus → pasa el pasaje al generador y persiste method', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const stimulus = {
      sectionId: 'sec-1',
      kind: 'passage' as const,
      source: 'official' as const,
      title: 'La abeja',
      text: 'Las abejas polinizan las flores.',
    };
    const resolver = makeResolver({ method: 'reuse_stimulus', stimulus });
    const gen = makeGenerator('practice_set', {
      content: { skillFocus: 's', itemCount: 0, items: [], notes: null, stimuli: [] },
      promptVersion: 'ola2-practice-stimulus-v1',
      audit: {},
    });
    const row = makeRow({
      type: 'practice_set',
      method: 'reuse_stimulus',
      assessmentId: 'assess-1',
      input: { stimulusId: 'sec-1' },
    });
    const runner = new RemedialRunner(makeDb(row), service, makeContext(), makeBrief(), resolver, [gen]);

    await runner.run('mat-1', 'org-1');

    // el runner lee el stimulusId persistido en input y lo pasa al resolver.
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: 'assess-1',
        method: 'reuse_stimulus',
        stimulusId: 'sec-1',
      }),
    );
    // el estímulo resuelto llega al generador.
    expect(gen.generate).toHaveBeenCalledWith(expect.objectContaining({ stimulus }));
    // se persiste el método efectivo.
    expect(service.markReady).toHaveBeenCalledWith(
      'mat-1',
      'org-1',
      expect.objectContaining({ method: 'reuse_stimulus' }),
    );
  });

  it('NotFoundException del resolver (pasaje inválido) → markFailed con el mensaje', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const resolver = makeResolver();
    (resolver.resolve as jest.Mock).mockRejectedValue(
      new NotFoundException('Estímulo no encontrado o no es un pasaje visible para la organización'),
    );
    const gen = makeGenerator('practice_set', validResult);
    const row = makeRow({ type: 'practice_set', method: 'reuse_stimulus' });
    const runner = new RemedialRunner(makeDb(row), service, makeContext(), makeBrief(), resolver, [gen]);

    await runner.run('mat-1', 'org-1');

    expect(service.markFailed).toHaveBeenCalledWith(
      'mat-1',
      'org-1',
      expect.stringContaining('Estímulo no encontrado'),
    );
    expect(gen.generate).not.toHaveBeenCalled();
    expect(service.markReady).not.toHaveBeenCalled();
  });

  it('si el generador lanza → markFailed (nunca tumba el proceso)', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const gen = makeGenerator('guide', undefined);
    (gen.generate as jest.Mock).mockRejectedValue(new Error('llm caído'));
    const runner = new RemedialRunner(
      makeDb(makeRow()),
      service,
      makeContext(),
      makeBrief(),
      makeResolver(),
      [gen],
    );

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
      makeResolver(),
      [], // sin generadores
    );

    await runner.run('mat-1', 'org-1');
    expect(service.markFailed).toHaveBeenCalled();
  });

  it('si el material no existe → markFailed', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const gen = makeGenerator('guide', validResult);
    const runner = new RemedialRunner(
      makeDb(undefined),
      service,
      makeContext(),
      makeBrief(),
      makeResolver(),
      [gen],
    );

    await runner.run('missing', 'org-1');
    expect(service.markFailed).toHaveBeenCalled();
    expect(service.markProcessing).not.toHaveBeenCalled();
  });
});
