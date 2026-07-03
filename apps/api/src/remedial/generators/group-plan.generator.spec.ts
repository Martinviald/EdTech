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

/** Mock DB: el select de skill_results devuelve `belowRows` (alumnos bajo umbral). */
function makeDb(belowRows: Array<{ percentage: string | null }>): Database {
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
    const db = makeDb([{ percentage: '40.00' }, { percentage: '55.00' }, { percentage: '20.00' }]);
    const gen = new GroupPlanGenerator(llm, db);
    const result = await gen.generate(makeInput());

    if ('studentCount' in result.content) {
      expect(result.content.studentCount).toBe(3); // no 999
    }
  });

  it('calcula el promedio de logro del grupo bajo umbral', async () => {
    const { llm } = makeLlm(JSON.stringify(validPlan));
    const db = makeDb([{ percentage: '40.00' }, { percentage: '60.00' }]);
    const gen = new GroupPlanGenerator(llm, db);
    const result = await gen.generate(makeInput());
    const aggregates = (result.audit as { aggregates: { averagePct: number | null } }).aggregates;
    expect(aggregates.averagePct).toBe(50);
  });

  it('NO envía PII al LLM (sin nombres/rut/studentId en el prompt)', async () => {
    const { llm, completeWithUsage } = makeLlm(JSON.stringify(validPlan));
    const db = makeDb([{ percentage: '30.00' }]);
    const gen = new GroupPlanGenerator(llm, db);
    await gen.generate(makeInput());

    const [, prompt] = completeWithUsage.mock.calls[0]!;
    expect(prompt).not.toMatch(/rut|firstName|lastName|studentId/i);
    // solo agregados: el conteo sí va
    expect(prompt).toMatch(/studentCount.*1|1.*alumno/i);
  });

  it('el audit no contiene PII (solo agregados + contexto curricular)', async () => {
    const { llm } = makeLlm(JSON.stringify(validPlan));
    const db = makeDb([{ percentage: '30.00' }]);
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
    const gen = new GroupPlanGenerator(llm, makeDb([{ percentage: '30.00' }]));
    await expect(gen.generate(makeInput())).rejects.toThrow(/no cumple el schema/);
  });

  it('promptVersion es s3-group-plan-v1', async () => {
    const { llm } = makeLlm(JSON.stringify(validPlan));
    const gen = new GroupPlanGenerator(llm, makeDb([{ percentage: '30.00' }]));
    const result = await gen.generate(makeInput());
    expect(result.promptVersion).toBe('s3-group-plan-v1');
  });
});
