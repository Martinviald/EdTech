import type { CurriculumContext } from '@soe/types';
import type { CurriculumRetriever } from '../curriculum-retriever/curriculum-retriever';
import { RemedialContextService } from './remedial-context.service';

function makeCtx(overrides: Partial<CurriculumContext> = {}): CurriculumContext {
  return {
    node: {
      id: 'node-1',
      code: 'OA3',
      name: 'Comprensión inferencial',
      description: 'Inferir información',
      type: 'learning_objective',
    },
    ancestors: [
      { id: 'a1', code: 'EJE', name: 'Lectura', description: null, type: 'axis' },
    ],
    descriptors: [
      { id: 'd1', code: null, name: 'Inferir causa', description: null, type: 'descriptor' },
    ],
    siblings: [
      { id: 's1', code: 'OA4', name: 'Comprensión literal', description: null, type: 'learning_objective' },
    ],
    taggedItems: [
      { itemId: 'i1', position: 1, type: 'multiple_choice', stem: '¿Qué infiere el texto?' },
      { itemId: 'i2', position: 2, type: 'multiple_choice', stem: null }, // sin stem → se filtra
    ],
    ...overrides,
  };
}

function makeRetriever(ctx: CurriculumContext): CurriculumRetriever {
  return { getContext: jest.fn().mockResolvedValue(ctx) };
}

describe('RemedialContextService', () => {
  it('ensambla el contexto curricular desde el retriever', async () => {
    const ctx = makeCtx();
    const service = new RemedialContextService(makeRetriever(ctx));
    const result = await service.assemble('node-1');

    expect(result.nodeId).toBe('node-1');
    expect(result.target.name).toBe('Comprensión inferencial');
    expect(result.ancestors).toHaveLength(1);
    expect(result.descriptors).toHaveLength(1);
    expect(result.siblings).toHaveLength(1);
  });

  it('incluye few-shot solo de ítems con stem (descarta los sin stem)', async () => {
    const service = new RemedialContextService(makeRetriever(makeCtx()));
    const result = await service.assemble('node-1');
    expect(result.fewShotItems).toHaveLength(1);
    expect(result.fewShotItems[0]!.stem).toBe('¿Qué infiere el texto?');
  });

  it('limita el few-shot a un máximo acotado', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      itemId: `i${i}`,
      position: i,
      type: 'multiple_choice',
      stem: `pregunta ${i}`,
    }));
    const service = new RemedialContextService(
      makeRetriever(makeCtx({ taggedItems: many })),
    );
    const result = await service.assemble('node-1');
    expect(result.fewShotItems.length).toBeLessThanOrEqual(5);
  });

  it('propaga el nodeId al retriever', async () => {
    const retriever = makeRetriever(makeCtx());
    const service = new RemedialContextService(retriever);
    await service.assemble('node-xyz');
    expect(retriever.getContext).toHaveBeenCalledWith('node-xyz');
  });

  it('no expone ids internos crudos de descriptores (solo forma legible)', async () => {
    const service = new RemedialContextService(makeRetriever(makeCtx()));
    const result = await service.assemble('node-1');
    expect(result.descriptors[0]).not.toHaveProperty('id');
    expect(result.target).not.toHaveProperty('id');
  });
});
