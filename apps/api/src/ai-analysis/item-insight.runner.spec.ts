import type { Database } from '@soe/db';
import type { ItemInsightOutput, ItemInsightSnapshot } from '@soe/types';
import { LlmService } from '../llm/llm.service';
import { AiAnalysisService } from './ai-analysis.service';
import { ItemInsightRunner } from './item-insight.runner';
import type { ItemInsightBuilder, ItemInsightBuildResult } from './item-insight.port';
import { ITEM_INSIGHT_PROMPT_VERSION } from './prompts/item-insight.prompt';
import type { LlmImagePart } from '../llm/llm.types';

// ──────────────────────────────────────────────────────────────────────────────
// Mocks: DB (loadRecord vía withOrgContext → transaction → select), el puerto
// ItemInsightBuilder, LlmService (completeMultimodal) y AiAnalysisService.
// ──────────────────────────────────────────────────────────────────────────────

type SelectChain = {
  from: (..._: unknown[]) => SelectChain;
  where: (..._: unknown[]) => SelectChain;
  limit: (..._: unknown[]) => Promise<unknown[]>;
};

function makeDb(record: Record<string, unknown> | null): Database {
  const select = (): SelectChain => {
    const chain: SelectChain = {
      from: () => chain,
      where: () => chain,
      limit: async () => (record ? [record] : []),
    };
    return chain;
  };
  const db = {
    select,
    execute: async () => undefined,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
  };
  return db as unknown as Database;
}

function baseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    orgId: 'org-1',
    assessmentId: 'as-1',
    classGroupId: null,
    analysisType: 'item_insight',
    audience: 'teacher',
    status: 'pending',
    input: { itemId: 'item-1', assessmentId: 'as-1' },
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ItemInsightSnapshot> = {},
): ItemInsightSnapshot {
  return {
    itemId: 'item-1',
    position: 7,
    assessmentId: 'as-1',
    instrumentName: 'DIA Lenguaje',
    type: 'multiple_choice',
    stem: '¿Qué quiso decir el autor?',
    correctKey: 'B',
    alternatives: [
      { key: 'A', text: 'a', isCorrect: false, count: 3, percentage: 12 },
      { key: 'B', text: 'b', isCorrect: true, count: 7, percentage: 28 },
      { key: 'C', text: 'c', isCorrect: false, count: 4, percentage: 16 },
      { key: 'D', text: 'd', isCorrect: false, count: 11, percentage: 44 },
    ],
    totalResponses: 25,
    blankCount: 0,
    correctRate: 28,
    difficulty: 0.28,
    discrimination: 0.12,
    pointBiserial: 0.09,
    dominantDistractor: 'D',
    skillName: 'Inferir',
    contentName: 'Comprensión lectora',
    tags: [{ nodeName: 'Inferir', nodeType: 'skill', nodeCode: null }],
    passage: null,
    images: [],
    ...overrides,
  };
}

function validOutput(overrides: Partial<ItemInsightOutput> = {}): ItemInsightOutput {
  return {
    headline: 'El distractor D revela una misconcepción.',
    performanceSummary: 'Solo el 28% acertó; D concentra el 44%.',
    likelyCause: 'misconception',
    misconception: 'Confunden inferencia con dato literal.',
    distractorAnalysis: [
      { key: 'D', interpretation: 'Eligen lo literal, no la inferencia.' },
    ],
    passageInsight: null,
    visualInsight: null,
    itemQuality: { verdict: 'review', notes: 'Punto-biserial bajo, vigilar.' },
    recommendedActions: ['Modelar inferencias con pistas del texto.'],
    confidence: 0.7,
    caveats: ['Muestra acotada.'],
    ...overrides,
  };
}

function makeRunner(opts: {
  record?: Record<string, unknown> | null;
  llmComplete: (
    system: string,
    prompt: string,
    images?: LlmImagePart[],
  ) => Promise<string>;
  buildResult?: () => Promise<ItemInsightBuildResult>;
}): {
  runner: ItemInsightRunner;
  markProcessing: jest.Mock;
  markCompleted: jest.Mock;
  markFailed: jest.Mock;
  build: jest.Mock;
  completeMultimodal: jest.Mock;
} {
  const db = makeDb(opts.record === undefined ? baseRecord() : opts.record);
  const completeMultimodal = jest.fn(opts.llmComplete);
  const llm = { completeMultimodal } as unknown as LlmService;
  const build = jest.fn(
    opts.buildResult ??
      (async () => ({ snapshot: makeSnapshot(), images: [] })),
  );
  const snapshot = { build } as unknown as ItemInsightBuilder;
  const markProcessing = jest.fn().mockResolvedValue(undefined);
  const markCompleted = jest.fn().mockResolvedValue(undefined);
  const markFailed = jest.fn().mockResolvedValue(undefined);
  const service = {
    markProcessing,
    markCompleted,
    markFailed,
  } as unknown as AiAnalysisService;
  const runner = new (ItemInsightRunner as new (
    db: Database,
    llm: LlmService,
    service: AiAnalysisService,
    snapshot: ItemInsightBuilder,
  ) => ItemInsightRunner)(db, llm, service, snapshot);
  return { runner, markProcessing, markCompleted, markFailed, build, completeMultimodal };
}

describe('ItemInsightRunner.run', () => {
  it('happy path: snapshot → prompt → LLM → output válido → completed', async () => {
    const { runner, markProcessing, markCompleted, markFailed, build } = makeRunner({
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    await runner.run('a-1', 'org-1');

    expect(markProcessing).toHaveBeenCalledWith('a-1', 'org-1');
    expect(build).toHaveBeenCalledTimes(1);
    // build recibe (user sintético, itemId, { assessmentId, classGroupId })
    const buildArgs = build.mock.calls[0]!;
    expect(buildArgs[1]).toBe('item-1');
    expect(buildArgs[2]).toEqual({ assessmentId: 'as-1', classGroupId: undefined });
    expect(markCompleted).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();

    const arg = markCompleted.mock.calls[0]![2] as {
      output: ItemInsightOutput;
      promptVersion: string;
    };
    expect(arg.output.headline).toBe(validOutput().headline);
    expect(arg.promptVersion).toBe(ITEM_INSIGHT_PROMPT_VERSION);
  });

  it('sin imágenes: llama completeMultimodal con images=[] (cae a texto en el service)', async () => {
    let capturedImages: LlmImagePart[] | undefined = [{ mimeType: 'x', data: 'y' }];
    const { runner, completeMultimodal } = makeRunner({
      llmComplete: async (_s, _p, images) => {
        capturedImages = images;
        return JSON.stringify(validOutput());
      },
    });
    await runner.run('a-1', 'org-1');
    expect(completeMultimodal).toHaveBeenCalledTimes(1);
    expect(capturedImages).toEqual([]);
  });

  it('con imágenes: pasa las imágenes base64 a completeMultimodal', async () => {
    let capturedImages: LlmImagePart[] | undefined;
    const images: LlmImagePart[] = [{ mimeType: 'image/png', data: 'AAAA' }];
    const { runner, completeMultimodal } = makeRunner({
      buildResult: async () => ({
        snapshot: makeSnapshot({
          images: [
            { url: 'https://x/y.png', mimeType: 'image/png', note: null, source: 'item' },
          ],
        }),
        images,
      }),
      llmComplete: async (_s, _p, imgs) => {
        capturedImages = imgs;
        return JSON.stringify(validOutput({ visualInsight: 'Se ve un mapa.' }));
      },
    });
    await runner.run('a-1', 'org-1');
    expect(completeMultimodal).toHaveBeenCalledTimes(1);
    expect(capturedImages).toEqual(images);
  });

  it('tolera fences ```json alrededor del JSON', async () => {
    const { runner, markCompleted, markFailed } = makeRunner({
      llmComplete: async () => '```json\n' + JSON.stringify(validOutput()) + '\n```',
    });
    await runner.run('a-1', 'org-1');
    expect(markCompleted).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('salida no parseable (no JSON) → failed', async () => {
    const { runner, markCompleted, markFailed } = makeRunner({
      llmComplete: async () => 'esto no es json',
    });
    await runner.run('a-1', 'org-1');
    expect(markCompleted).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('no es JSON');
  });

  it('JSON válido pero que no cumple el schema estricto → failed', async () => {
    const { runner, markCompleted, markFailed } = makeRunner({
      llmComplete: async () => JSON.stringify({ headline: 'incompleto' }),
    });
    await runner.run('a-1', 'org-1');
    expect(markCompleted).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('no cumple el schema');
  });

  it('pasa classGroupId del registro al snapshot builder', async () => {
    const { runner, build } = makeRunner({
      record: baseRecord({ classGroupId: 'cg-9' }),
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    await runner.run('a-1', 'org-1');
    expect(build.mock.calls[0]![2]).toEqual({
      assessmentId: 'as-1',
      classGroupId: 'cg-9',
    });
  });

  it('lee itemId desde input jsonb; sin itemId → failed sin llamar al LLM', async () => {
    const { runner, markProcessing, markFailed, completeMultimodal } = makeRunner({
      record: baseRecord({ input: { assessmentId: 'as-1' } }),
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    await runner.run('a-1', 'org-1');
    expect(markProcessing).not.toHaveBeenCalled();
    expect(completeMultimodal).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('itemId');
  });

  it('error del LLM → failed (no tumba el proceso)', async () => {
    const { runner, markFailed } = makeRunner({
      llmComplete: async () => {
        throw new Error('llm down');
      },
    });
    await runner.run('a-1', 'org-1');
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('llm down');
  });

  it('error del snapshot builder → failed (sin llamar al LLM)', async () => {
    const { runner, markFailed, completeMultimodal } = makeRunner({
      llmComplete: async () => JSON.stringify(validOutput()),
      buildResult: async () => {
        throw new Error('snapshot boom');
      },
    });
    await runner.run('a-1', 'org-1');
    expect(completeMultimodal).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('snapshot boom');
  });

  it('timeout → failed', async () => {
    process.env.AI_ANALYSIS_TIMEOUT_MS = '20';
    const { runner, markCompleted, markFailed } = makeRunner({
      llmComplete: () =>
        new Promise((resolve) => setTimeout(() => resolve('tarde'), 200)),
    });
    await runner.run('a-1', 'org-1');
    delete process.env.AI_ANALYSIS_TIMEOUT_MS;
    expect(markCompleted).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('Timeout');
  });

  it('registro inexistente → failed, sin markProcessing', async () => {
    const { runner, markProcessing, markFailed } = makeRunner({
      record: null,
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    await runner.run('missing', 'org-1');
    expect(markProcessing).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
  });
});
