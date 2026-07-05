import { NotFoundException } from '@nestjs/common';
import type { JudgeVerdict } from '@soe/types';
import type { Database, RemedialMaterial } from '@soe/db';
import type { RemedialBriefService } from './remedial-brief.service';
import type { RemedialContextService } from './remedial-context.service';
import type { RemedialJudgeService } from './remedial-judge.service';
import { RemedialQualityLoop } from './remedial-quality-loop.service';
import type { RemedialService } from './remedial.service';
import type { RemedialGenerator, RemedialJudgeItem } from './remedial.generator';
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

type DbMock = Database & { __updates: Array<Record<string, unknown>> };

function makeDb(row: RemedialMaterial | undefined): DbMock {
  const updates: Array<Record<string, unknown>> = [];
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(row ? [row] : []),
  };
  const db = {
    select: () => selectChain,
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    __updates: updates,
  } as unknown as DbMock;
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

/** Juez mockeado: devuelve los mismos veredictos en cada ronda. */
function makeJudge(verdicts: JudgeVerdict[] = []) {
  return {
    judge: jest.fn().mockResolvedValue(verdicts),
  } as unknown as RemedialJudgeService & { judge: jest.Mock };
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

const judgeItem: RemedialJudgeItem = {
  position: 1,
  itemId: 'it-1',
  stem: '¿Qué dice el texto?',
  alternatives: [
    { key: 'A', text: 'correcta', isCorrect: true },
    { key: 'B', text: 'incorrecta', isCorrect: false },
  ],
  explanation: null,
};

/** Resultado de un practice_set con `judgeItems` (lo que el loop necesita). */
function makePracticeResult() {
  return {
    content: {
      skillFocus: 's',
      itemCount: 1,
      items: [{ itemId: 'it-1', position: 1, stem: judgeItem.stem }],
      notes: null,
      stimuli: [],
    },
    promptVersion: 'ola2-practice-stimulus-v1',
    audit: {},
    model: 'gemini-2.5-pro',
    tokens: { input: 10, output: 5 },
    costUsd: '0.000100',
    judgeItems: [judgeItem],
  };
}

const passVerdict: JudgeVerdict = {
  position: 1,
  answerable: true,
  derivedAnswer: 'A',
  uniqueCorrect: true,
  factual: true,
  skillMatch: true,
  objections: [],
};

const hardFailVerdict: JudgeVerdict = {
  position: 1,
  answerable: false,
  derivedAnswer: 'B',
  uniqueCorrect: true,
  factual: true,
  skillMatch: true,
  objections: ['La clave no se deduce del texto'],
};

describe('RemedialRunner', () => {
  it('happy path (guide): markProcessing → brief+contexto+estímulo (con orgId) → generate → markReady sin juez', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const context = makeContext() as RemedialContextService & { assemble: jest.Mock };
    const brief = makeBrief({ rootCauseHypothesis: 'rc', realErrors: [] });
    const resolver = makeResolver();
    const judge = makeJudge();
    const gen = makeGenerator('guide', validResult);
    const runner = new RemedialRunner(
      makeDb(makeRow()),
      service,
      context,
      brief,
      resolver,
      judge,
      new RemedialQualityLoop(),
      [gen],
    );

    await runner.run('mat-1', 'org-1');

    expect(service.markProcessing).toHaveBeenCalledWith('mat-1', 'org-1');
    expect(context.assemble).toHaveBeenCalledWith('node-1', 'org-1');
    expect(brief.build).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', nodeId: 'node-1' }),
    );
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', nodeId: 'node-1', method: 'self_contained' }),
    );
    // El juez/loop NO corre para guide (solo practice_set); markReady sin qualityReport.
    expect(judge.judge).not.toHaveBeenCalled();
    expect(service.markReady).toHaveBeenCalledWith(
      'mat-1',
      'org-1',
      expect.objectContaining({
        method: 'self_contained',
        qualityReport: null,
        input: expect.objectContaining({ brief: { rootCauseHypothesis: 'rc', realErrors: [] } }),
      }),
    );
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it('practice_set: corre el loop, juzga con el estímulo y persiste el qualityReport (converged)', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const stimulus = {
      sectionId: 'sec-1',
      kind: 'passage' as const,
      source: 'official' as const,
      title: 'La abeja',
      text: 'Las abejas polinizan las flores.',
    };
    const resolver = makeResolver({ method: 'reuse_stimulus', stimulus });
    const judge = makeJudge([passVerdict]);
    const gen = makeGenerator('practice_set', makePracticeResult());
    const row = makeRow({
      type: 'practice_set',
      method: 'reuse_stimulus',
      assessmentId: 'assess-1',
      input: { stimulusId: 'sec-1' },
    });
    const runner = new RemedialRunner(
      makeDb(row),
      service,
      makeContext(),
      makeBrief(),
      resolver,
      judge,
      new RemedialQualityLoop(),
      [gen],
    );

    await runner.run('mat-1', 'org-1');

    // El estímulo resuelto llega al generador (ronda 0, sin feedback).
    expect(gen.generate).toHaveBeenCalledWith(
      expect.objectContaining({ stimulus, feedback: undefined }),
    );
    // El juez recibe orgId + estímulo + los judgeItems del batch.
    expect(judge.judge).toHaveBeenCalledWith('org-1', stimulus, [judgeItem]);
    // Converge en la ronda 0 → qualityReport persistido; método efectivo reuse_stimulus.
    expect(service.markReady).toHaveBeenCalledWith(
      'mat-1',
      'org-1',
      expect.objectContaining({
        method: 'reuse_stimulus',
        qualityReport: { iterations: 1, finalStatus: 'converged', verdicts: [passVerdict] },
      }),
    );
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it('practice_set: falla dura persistente → exhausted a las 3 + soft-delete de rondas previas', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const judge = makeJudge([hardFailVerdict]);
    const gen = makeGenerator('practice_set', makePracticeResult());
    const db = makeDb(makeRow({ type: 'practice_set', method: 'self_contained' }));
    const runner = new RemedialRunner(
      db,
      service,
      makeContext(),
      makeBrief(),
      makeResolver(),
      judge,
      new RemedialQualityLoop(),
      [gen],
    );

    await runner.run('mat-1', 'org-1');

    // 3 rondas de generación (ronda 0 + 2 regeneraciones).
    expect((gen.generate as jest.Mock)).toHaveBeenCalledTimes(3);
    // La 2ª y 3ª generación reciben las objeciones del juez como feedback.
    expect(gen.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ feedback: ['La clave no se deduce del texto'] }),
    );
    // Soft-delete de las 2 rondas descartadas (deletedAt).
    const softDeletes = db.__updates.filter((u) => 'deletedAt' in u);
    expect(softDeletes).toHaveLength(2);
    // Queda draft (exhausted) con el reporte.
    expect(service.markReady).toHaveBeenCalledWith(
      'mat-1',
      'org-1',
      expect.objectContaining({
        qualityReport: { iterations: 3, finalStatus: 'exhausted', verdicts: [hardFailVerdict] },
      }),
    );
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it('NotFoundException del resolver (pasaje inválido) → markFailed; nunca genera ni juzga', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const resolver = makeResolver();
    (resolver.resolve as jest.Mock).mockRejectedValue(
      new NotFoundException('Estímulo no encontrado o no es un pasaje visible para la organización'),
    );
    const judge = makeJudge([passVerdict]);
    const gen = makeGenerator('practice_set', makePracticeResult());
    const row = makeRow({ type: 'practice_set', method: 'reuse_stimulus' });
    const runner = new RemedialRunner(
      makeDb(row),
      service,
      makeContext(),
      makeBrief(),
      resolver,
      judge,
      new RemedialQualityLoop(),
      [gen],
    );

    await runner.run('mat-1', 'org-1');

    expect(service.markFailed).toHaveBeenCalledWith(
      'mat-1',
      'org-1',
      expect.stringContaining('Estímulo no encontrado'),
    );
    expect(gen.generate).not.toHaveBeenCalled();
    expect(judge.judge).not.toHaveBeenCalled();
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
      makeJudge(),
      new RemedialQualityLoop(),
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
      makeJudge(),
      new RemedialQualityLoop(),
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
      makeJudge(),
      new RemedialQualityLoop(),
      [gen],
    );

    await runner.run('missing', 'org-1');
    expect(service.markFailed).toHaveBeenCalled();
    expect(service.markProcessing).not.toHaveBeenCalled();
  });

  // ── Retry ante fallos transitorios de red del LLM (Ola 1‑resto G13) ─────────
  it('reintenta ante un fallo TRANSITORIO del generador y luego tiene éxito (G13)', async () => {
    process.env.REMEDIAL_RETRY_BACKOFF_MS = '0'; // sin espera en el test
    const service = makeService() as ReturnType<typeof makeService>;
    const gen = makeGenerator('guide', validResult);
    // 1er intento: blip de red; 2do intento: éxito (valor por defecto del mock).
    (gen.generate as jest.Mock).mockRejectedValueOnce(new Error('fetch failed'));
    const runner = new RemedialRunner(
      makeDb(makeRow()),
      service,
      makeContext(),
      makeBrief(),
      makeResolver(),
      makeJudge(),
      new RemedialQualityLoop(),
      [gen],
    );

    await runner.run('mat-1', 'org-1');
    delete process.env.REMEDIAL_RETRY_BACKOFF_MS;

    expect(gen.generate as jest.Mock).toHaveBeenCalledTimes(2);
    expect(service.markReady).toHaveBeenCalled();
    expect(service.markFailed).not.toHaveBeenCalled();
  });

  it('NO reintenta un error de parseo/schema (falla directo, un solo intento) (G13)', async () => {
    const service = makeService() as ReturnType<typeof makeService>;
    const gen = makeGenerator('guide', validResult);
    (gen.generate as jest.Mock).mockReset();
    (gen.generate as jest.Mock).mockRejectedValue(
      new Error('El set de ítems generado no cumple el schema: campo faltante'),
    );
    const runner = new RemedialRunner(
      makeDb(makeRow()),
      service,
      makeContext(),
      makeBrief(),
      makeResolver(),
      makeJudge(),
      new RemedialQualityLoop(),
      [gen],
    );

    await runner.run('mat-1', 'org-1');

    expect(gen.generate as jest.Mock).toHaveBeenCalledTimes(1);
    expect(service.markFailed).toHaveBeenCalled();
    expect(service.markReady).not.toHaveBeenCalled();
  });

  it('practice_set: reintenta un fallo TRANSITORIO de generación DENTRO del loop (G13)', async () => {
    process.env.REMEDIAL_RETRY_BACKOFF_MS = '0';
    const service = makeService() as ReturnType<typeof makeService>;
    const judge = makeJudge([passVerdict]);
    const gen = makeGenerator('practice_set', makePracticeResult());
    // Ronda 0: 1er intento blip de red, 2do intento éxito → juzga → converge. El retry
    // envuelve la generación DENTRO del loop (no dispara una 2ª ronda de regeneración).
    (gen.generate as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));
    const runner = new RemedialRunner(
      makeDb(makeRow({ type: 'practice_set', method: 'self_contained' })),
      service,
      makeContext(),
      makeBrief(),
      makeResolver(),
      judge,
      new RemedialQualityLoop(),
      [gen],
    );

    await runner.run('mat-1', 'org-1');
    delete process.env.REMEDIAL_RETRY_BACKOFF_MS;

    // 2 llamadas al generador: el reintento de la ronda 0, no una 2ª ronda del loop.
    expect(gen.generate as jest.Mock).toHaveBeenCalledTimes(2);
    // Convergió en la ronda 0 (1 iteración) pese al blip.
    expect(service.markReady).toHaveBeenCalledWith(
      'mat-1',
      'org-1',
      expect.objectContaining({
        qualityReport: { iterations: 1, finalStatus: 'converged', verdicts: [passVerdict] },
      }),
    );
    expect(service.markFailed).not.toHaveBeenCalled();
  });
});
