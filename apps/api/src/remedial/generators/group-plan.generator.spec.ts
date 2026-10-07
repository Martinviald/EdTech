import type { Database, RemedialMaterial } from '@soe/db';
import type { LlmService } from '../../llm/llm.service';
import type { RemedialCurriculumContext } from '../remedial-context.service';
import type { RemedialGenerationInput } from '../remedial.generator';
import { GroupPlanGenerator } from './group-plan.generator';

function makeCurriculum(): RemedialCurriculumContext {
  return {
    nodeId: 'node-1',
    target: { code: 'OA3', name: 'Inferencias', description: null, type: 'learning_objective' },
    ancestors: [],
    descriptors: [],
    siblings: [],
    fewShotItems: [],
  };
}

function makeInput(overrides: Partial<RemedialMaterial> = {}): RemedialGenerationInput {
  return {
    material: {
      id: 'mat-1',
      nodeId: 'node-1',
      classGroupId: 'cg-1',
      createdById: 'user-1',
      ...overrides,
    } as RemedialMaterial,
    orgId: 'org-1',
    curriculum: makeCurriculum(),
  };
}

function makeLlm(response: string): {
  llm: LlmService;
  completeWithUsage: jest.Mock;
} {
  const completeWithUsage = jest.fn().mockResolvedValue({
    text: response,
    model: 'gemini-2.5-flash',
    usage: { inputTokens: 100, outputTokens: 50 },
  });
  return { llm: { completeWithUsage } as unknown as LlmService, completeWithUsage };
}

type BelowRow = { scoreSum: string; maxSum: string };

function below(scoreSum: number, maxSum: number): BelowRow {
  return { scoreSum: scoreSum.toFixed(2), maxSum: maxSum.toFixed(2) };
}

function makeDb(belowRows: BelowRow[]): Database {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(belowRows),
  };
  const db = {
    select: () => chain,
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  } as unknown as Database;
  return db;
}

const validPlan = {
  groupLabel: 'Grupo refuerzo inferencial',
  studentCount: 999, // el modelo MIENTE; backend lo sobrescribe
  sharedGap: 'Inferencias',
  sequence: [{ order: 1, title: 'Sesión 1', description: 'Modelado', linkedNodeId: null }],
  estimatedSessions: 3,
};

describe('GroupPlanGenerator', () => {
  it('studentCount es DETERMINISTA (backend), ignora el del modelo', async () => {
    const { llm } = makeLlm(JSON.stringify(validPlan));
    const db = makeDb([below(4, 10), below(11, 20), below(2, 10)]);
    const gen = new GroupPlanGenerator(llm, db);
    const result = await gen.generate(makeInput());

    if ('studentCount' in result.content) {
      expect(result.content.studentCount).toBe(3); // no 999
    }
  });

  it('calcula el logro del grupo bajo umbral como Σ puntaje ÷ Σ máximo (14 ÷ 30 = 46,67), no como promedio de % (40 y 50 → 45)', async () => {
    const { llm } = makeLlm(JSON.stringify(validPlan));
    const db = makeDb([below(4, 10), below(10, 20)]);
    const gen = new GroupPlanGenerator(llm, db);
    const result = await gen.generate(makeInput());
    const aggregates = (result.audit as { aggregates: { averagePct: number | null } }).aggregates;
    expect(aggregates.averagePct).toBe(46.67);
  });

  it('NO envía PII al LLM (sin nombres/rut/studentId en el prompt)', async () => {
    const { llm, completeWithUsage } = makeLlm(JSON.stringify(validPlan));
    const db = makeDb([below(3, 10)]);
    const gen = new GroupPlanGenerator(llm, db);
    await gen.generate(makeInput());

    const [, prompt] = completeWithUsage.mock.calls[0]!;
    expect(prompt).not.toMatch(/rut|firstName|lastName|studentId/i);
    // solo agregados: el conteo sí va
    expect(prompt).toMatch(/studentCount.*1|1.*alumno/i);
  });

  it('el audit no contiene PII (solo agregados + contexto curricular)', async () => {
    const { llm } = makeLlm(JSON.stringify(validPlan));
    const db = makeDb([below(3, 10)]);
    const gen = new GroupPlanGenerator(llm, db);
    const result = await gen.generate(makeInput());
    const serialized = JSON.stringify(result.audit);
    expect(serialized).not.toMatch(/rut|firstName|lastName|studentId/i);
  });

  it('lanza si falta classGroupId', async () => {
    const { llm } = makeLlm(JSON.stringify(validPlan));
    const gen = new GroupPlanGenerator(llm, makeDb([]));
    await expect(gen.generate(makeInput({ classGroupId: null }))).rejects.toThrow(/classGroupId/);
  });

  it('lanza si el plan no cumple el schema', async () => {
    const { llm } = makeLlm(JSON.stringify({ groupLabel: 'x' }));
    const gen = new GroupPlanGenerator(llm, makeDb([below(3, 10)]));
    await expect(gen.generate(makeInput())).rejects.toThrow(/no cumple el schema/);
  });

  it('promptVersion es s3-group-plan-v1', async () => {
    const { llm } = makeLlm(JSON.stringify(validPlan));
    const gen = new GroupPlanGenerator(llm, makeDb([below(3, 10)]));
    const result = await gen.generate(makeInput());
    expect(result.promptVersion).toBe('s3-group-plan-v1');
  });
});
