import type { Database } from '@soe/db';
import type { AiAnalysisSnapshot, AssessmentInsightsOutput } from '@soe/types';
import { LlmService } from '../llm/llm.service';
import { AiAnalysisService } from './ai-analysis.service';
import { AiAnalysisRunner } from './ai-analysis.runner';
import type { SnapshotBuilder } from './snapshot.port';
import { PROMPT_VERSION } from './prompts/assessment-insights.prompt';

// ──────────────────────────────────────────────────────────────────────────────
// Mocks: DB (solo loadRecord, vía withOrgContext → transaction → select), el
// puerto SnapshotBuilder, LlmService y AiAnalysisService (markProcessing/Completed/
// Failed). El runner real recibe los 4 por DI.
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
    analysisType: 'assessment_insights',
    audience: 'director',
    status: 'pending',
    ...overrides,
  };
}

function makeSnapshot(): AiAnalysisSnapshot {
  return {
    assessmentId: 'as-1',
    instrumentName: 'DIA Lenguaje',
    gradeName: '4° básico',
    subjectName: 'Lenguaje',
    evaluated: 28,
    enrolled: 30,
    reliability: { kr20: 0.82 },
    items: [
      {
        position: 1,
        skillName: 'Localizar información',
        nodeId: 'node-1',
        difficulty: 0.9,
        discrimination: 0.4,
        pointBiserial: 0.35,
        correctLabel: 'A',
        dominantDistractor: 'C',
        distribution: { A: 25, B: 1, C: 2, D: 0 },
        stem: '¿Dónde ocurre la historia?',
      },
      {
        position: 2,
        skillName: 'Inferir',
        nodeId: 'node-2',
        difficulty: 0.25,
        discrimination: 0.1,
        pointBiserial: 0.08,
        correctLabel: 'B',
        dominantDistractor: 'D',
        distribution: { A: 3, B: 7, C: 4, D: 14 },
        stem: '¿Qué quiso decir el autor?',
      },
    ],
    skills: [
      {
        nodeId: 'node-1',
        nodeName: 'Localizar información',
        achievement: 0.88,
        itemCount: 1,
        expectedItemCount: 2,
        studentsBelowThreshold: 3,
      },
      {
        nodeId: 'node-2',
        nodeName: 'Inferir',
        achievement: 0.25,
        itemCount: 1,
        expectedItemCount: 2,
        studentsBelowThreshold: 18,
      },
    ],
  };
}

function validOutput(overrides: Partial<AssessmentInsightsOutput> = {}): AssessmentInsightsOutput {
  return {
    headline: 'El grupo domina localización pero falla en inferencia.',
    executiveSummary: {
      director: 'Priorizar refuerzo en inferencia a nivel de ciclo.',
      teacher: 'Re-enseñar estrategias de inferencia con textos cortos.',
    },
    topItems: [
      {
        position: 1,
        skillName: 'Localizar información',
        difficulty: 0.9,
        discrimination: 0.4,
        whatWorked: ['Enunciado claro', 'Alineado al OA'],
        replicableAction: 'Replicar preguntas literales bien acotadas.',
      },
    ],
    bottomItems: [
      {
        position: 2,
        skillName: 'Inferir',
        difficulty: 0.25,
        likelyCause: 'misconception',
        misconception: 'Confunden inferencia con dato literal.',
        actionPlan: ['Modelar inferencias con pistas del texto.'],
      },
    ],
    skillGaps: [
      {
        nodeId: 'node-2',
        nodeName: 'Inferir',
        achievement: 0.25,
        rootCauseHypothesis: 'Falta de práctica de inferencia.',
        misconceptionSignal: 'Distractor D concentra respuestas.',
        reteachStrategy: 'Lectura guiada con preguntas inferenciales.',
        exampleActivity: 'Detectives del texto: pistas y conclusiones.',
        remedialGroupSize: 18,
      },
    ],
    recommendations: [
      {
        audience: 'director',
        priority: 'high',
        title: 'Plan de refuerzo de inferencia',
        rationale: 'Brecha amplia y persistente.',
        suggestedActions: ['Asignar horas de taller'],
        linkedSkillIds: ['node-2'],
        linkedItemPositions: [2],
      },
    ],
    reliability: { kr20: 0.82, interpretation: 'Confiabilidad alta; los datos son sólidos.' },
    confidence: 0.8,
    caveats: ['2 alumnos no rindieron.'],
    ...overrides,
  };
}

function makeRunner(opts: {
  record?: Record<string, unknown> | null;
  llmComplete: () => Promise<string>;
  snapshotBuild?: () => Promise<AiAnalysisSnapshot>;
}): {
  runner: AiAnalysisRunner;
  markProcessing: jest.Mock;
  markCompleted: jest.Mock;
  markFailed: jest.Mock;
  snapshotBuild: jest.Mock;
  llmComplete: jest.Mock;
} {
  const db = makeDb(opts.record === undefined ? baseRecord() : opts.record);
  const llmComplete = jest.fn(opts.llmComplete);
  const llm = { complete: llmComplete } as unknown as LlmService;
  const snapshotBuild = jest.fn(opts.snapshotBuild ?? (async () => makeSnapshot()));
  const snapshot = { build: snapshotBuild } as unknown as SnapshotBuilder;
  const markProcessing = jest.fn().mockResolvedValue(undefined);
  const markCompleted = jest.fn().mockResolvedValue(undefined);
  const markFailed = jest.fn().mockResolvedValue(undefined);
  const service = { markProcessing, markCompleted, markFailed } as unknown as AiAnalysisService;
  const runner = new (AiAnalysisRunner as new (
    db: Database,
    llm: LlmService,
    service: AiAnalysisService,
    snapshot: SnapshotBuilder,
  ) => AiAnalysisRunner)(db, llm, service, snapshot);
  return { runner, markProcessing, markCompleted, markFailed, snapshotBuild, llmComplete };
}

describe('AiAnalysisRunner.run', () => {
  it('happy path: snapshot → prompt → LLM → output válido → completed', async () => {
    const { runner, markProcessing, markCompleted, markFailed, snapshotBuild } = makeRunner({
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    await runner.run('a-1', 'org-1');

    expect(markProcessing).toHaveBeenCalledWith('a-1', 'org-1');
    expect(snapshotBuild).toHaveBeenCalledWith('as-1', 'org-1', { classGroupId: undefined });
    expect(markCompleted).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();

    const arg = markCompleted.mock.calls[0]![2] as {
      output: AssessmentInsightsOutput;
      promptVersion: string;
    };
    expect(arg.output.headline).toBe(validOutput().headline);
    expect(arg.promptVersion).toBe(PROMPT_VERSION);
  });

  it('pasa classGroupId del registro al snapshot builder', async () => {
    const { runner, snapshotBuild } = makeRunner({
      record: baseRecord({ classGroupId: 'cg-9' }),
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    await runner.run('a-1', 'org-1');
    expect(snapshotBuild).toHaveBeenCalledWith('as-1', 'org-1', { classGroupId: 'cg-9' });
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

  it('audiencia director: el prompt enfatiza la mirada de gestión', async () => {
    let captured = '';
    const { runner } = makeRunner({
      record: baseRecord({ audience: 'director' }),
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    const llm = (runner as unknown as { llm: { complete: jest.Mock } }).llm;
    llm.complete.mockImplementation(async (_system: string, prompt: string) => {
      captured = prompt;
      return JSON.stringify(validOutput());
    });
    await runner.run('a-1', 'org-1');
    expect(captured).toContain('AUDIENCIA PRIMARIA: DIRECTIVO');
    expect(captured).not.toContain('AUDIENCIA PRIMARIA: PROFESOR');
  });

  it('audiencia profesor: el prompt enfatiza lo accionable de aula', async () => {
    let captured = '';
    const { runner } = makeRunner({
      record: baseRecord({ audience: 'teacher' }),
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    const llm = (runner as unknown as { llm: { complete: jest.Mock } }).llm;
    llm.complete.mockImplementation(async (_system: string, prompt: string) => {
      captured = prompt;
      return JSON.stringify(validOutput());
    });
    await runner.run('a-1', 'org-1');
    expect(captured).toContain('AUDIENCIA PRIMARIA: PROFESOR');
    expect(captured).not.toContain('AUDIENCIA PRIMARIA: DIRECTIVO');
  });

  it('audiencia desconocida cae a general (no rompe)', async () => {
    let captured = '';
    const { runner, markCompleted } = makeRunner({
      record: baseRecord({ audience: 'legacy_value' }),
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    const llm = (runner as unknown as { llm: { complete: jest.Mock } }).llm;
    llm.complete.mockImplementation(async (_system: string, prompt: string) => {
      captured = prompt;
      return JSON.stringify(validOutput());
    });
    await runner.run('a-1', 'org-1');
    expect(captured).toContain('AUDIENCIA: GENERAL');
    expect(markCompleted).toHaveBeenCalledTimes(1);
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

  it('reintenta ante fallo TRANSITORIO de red y completa (fetch failed → éxito)', async () => {
    process.env.AI_ANALYSIS_RETRY_BACKOFF_MS = '0';
    let calls = 0;
    const { runner, markCompleted, markFailed, llmComplete } = makeRunner({
      llmComplete: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('exception TypeError: fetch failed sending request');
        }
        return JSON.stringify(validOutput());
      },
    });
    await runner.run('a-1', 'org-1');
    delete process.env.AI_ANALYSIS_RETRY_BACKOFF_MS;
    expect(llmComplete).toHaveBeenCalledTimes(2);
    expect(markCompleted).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('NO reintenta errores no-transitorios → failed en un solo intento', async () => {
    const { runner, markFailed, llmComplete } = makeRunner({
      llmComplete: async () => {
        throw new Error('llm down');
      },
    });
    await runner.run('a-1', 'org-1');
    expect(llmComplete).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalledTimes(1);
  });

  it('timeout → failed', async () => {
    process.env.AI_ANALYSIS_TIMEOUT_MS = '20';
    const { runner, markCompleted, markFailed } = makeRunner({
      llmComplete: () => new Promise((resolve) => setTimeout(() => resolve('tarde'), 200)),
    });
    await runner.run('a-1', 'org-1');
    delete process.env.AI_ANALYSIS_TIMEOUT_MS;
    expect(markCompleted).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('Timeout');
  });

  it('error del snapshot builder → failed (sin llamar al LLM)', async () => {
    const { runner, markFailed, llmComplete } = makeRunner({
      llmComplete: async () => JSON.stringify(validOutput()),
      snapshotBuild: async () => {
        throw new Error('snapshot boom');
      },
    });
    await runner.run('a-1', 'org-1');
    expect(llmComplete).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('snapshot boom');
  });

  it('registro inexistente → failed (NotFound), sin markProcessing', async () => {
    const { runner, markProcessing, markFailed } = makeRunner({
      record: null,
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    await runner.run('missing', 'org-1');
    expect(markProcessing).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
  });

  it('análisis sin assessmentId → failed', async () => {
    const { runner, markFailed } = makeRunner({
      record: baseRecord({ assessmentId: null }),
      llmComplete: async () => JSON.stringify(validOutput()),
    });
    await runner.run('a-1', 'org-1');
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0]![2]).toContain('evaluación');
  });
});
