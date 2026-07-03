import type { RemedialMaterial } from '@soe/db';
import type { LlmService } from '../../llm/llm.service';
import type { RemedialCurriculumContext } from '../remedial-context.service';
import type { RemedialGenerationInput } from '../remedial.generator';
import { GuideGenerator } from './guide.generator';

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

function makeInput(): RemedialGenerationInput {
  return {
    material: { id: 'mat-1', nodeId: 'node-1', createdById: 'user-1' } as RemedialMaterial,
    orgId: 'org-1',
    curriculum: makeCurriculum(),
  };
}

function makeLlm(response: string): LlmService {
  return { complete: jest.fn().mockResolvedValue(response) } as unknown as LlmService;
}

const validGuide = {
  objective: 'Reenseñar inferencias',
  rootCauseSummary: 'Falta de práctica inferencial',
  strategy: 'Modelado + práctica guiada',
  classActivities: [{ title: 'Lectura guiada', description: 'Inferir causas', durationMin: 45 }],
  materials: ['Texto narrativo'],
  successCriteria: ['Identifica 3 inferencias'],
};

describe('GuideGenerator', () => {
  it('genera content válido (happy path)', async () => {
    const gen = new GuideGenerator(makeLlm(JSON.stringify(validGuide)));
    const result = await gen.generate(makeInput());
    expect(result.promptVersion).toBe('s3-guide-v1');
    expect(result.content).toMatchObject({ objective: 'Reenseñar inferencias' });
  });

  it('tolera fences ```json alrededor del JSON', async () => {
    const fenced = '```json\n' + JSON.stringify(validGuide) + '\n```';
    const gen = new GuideGenerator(makeLlm(fenced));
    const result = await gen.generate(makeInput());
    expect(result.content).toMatchObject({ strategy: 'Modelado + práctica guiada' });
  });

  it('lanza si la salida no es JSON', async () => {
    const gen = new GuideGenerator(makeLlm('no soy json'));
    await expect(gen.generate(makeInput())).rejects.toThrow(/no es JSON/);
  });

  it('lanza si el JSON no cumple el schema de la guía', async () => {
    const gen = new GuideGenerator(makeLlm(JSON.stringify({ objective: 'x' })));
    await expect(gen.generate(makeInput())).rejects.toThrow(/no cumple el schema/);
  });

  it('el audit no contiene PII (solo contexto curricular)', async () => {
    const gen = new GuideGenerator(makeLlm(JSON.stringify(validGuide)));
    const result = await gen.generate(makeInput());
    const serialized = JSON.stringify(result.audit);
    expect(serialized).toContain('curriculum');
    expect(serialized).not.toMatch(/rut|studentId|firstName|lastName/i);
  });
});
