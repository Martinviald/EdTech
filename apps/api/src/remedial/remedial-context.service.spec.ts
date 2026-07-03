import type {
  CurriculumContextWithProvenance,
  CurriculumRetriever,
  ReferenceItemRef,
} from '../curriculum-retriever/curriculum-retriever';
import { RemedialContextService } from './remedial-context.service';

function makeCtx(
  overrides: Partial<CurriculumContextWithProvenance> = {},
): CurriculumContextWithProvenance {
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
      {
        itemId: 'i1',
        position: 1,
        type: 'multiple_choice',
        stem: '¿Qué infiere el texto?',
        alternatives: [
          { key: 'A', text: 'Correcta', isCorrect: true },
          { key: 'B', text: 'Distractor', isCorrect: false },
        ],
        correctKey: 'A',
        explanation: 'Porque el texto lo sugiere',
        difficulty: null,
        subjectId: 'subj-1',
        gradeId: 'grade-1',
        fromNode: 'target',
      },
      {
        itemId: 'i2',
        position: 2,
        type: 'multiple_choice',
        stem: null, // sin stem → se filtra
        alternatives: null,
        correctKey: null,
        explanation: null,
        difficulty: null,
        subjectId: null,
        gradeId: null,
        fromNode: 'target',
      },
    ],
    ...overrides,
  };
}

function makeRetriever(ctx: CurriculumContextWithProvenance): CurriculumRetriever {
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
    const many: ReferenceItemRef[] = Array.from({ length: 12 }, (_, i) => ({
      itemId: `i${i}`,
      position: i,
      type: 'multiple_choice',
      stem: `pregunta ${i}`,
      alternatives: null,
      correctKey: null,
      explanation: null,
      difficulty: null,
      subjectId: null,
      gradeId: null,
      fromNode: 'target',
    }));
    const service = new RemedialContextService(
      makeRetriever(makeCtx({ taggedItems: many })),
    );
    const result = await service.assemble('node-1');
    expect(result.fewShotItems.length).toBeLessThanOrEqual(5);
  });

  it('expone referenceItems completos (alternativas + clave + explicación + procedencia)', async () => {
    const service = new RemedialContextService(makeRetriever(makeCtx()));
    const result = await service.assemble('node-1');

    expect(result.referenceItems).toBeDefined();
    expect(result.referenceItems).toHaveLength(1); // el sin-stem se descarta
    const ref = result.referenceItems![0]!;
    expect(ref.stem).toBe('¿Qué infiere el texto?');
    expect(ref.correctKey).toBe('A');
    expect(ref.explanation).toBe('Porque el texto lo sugiere');
    expect(ref.alternatives).toEqual([
      { key: 'A', text: 'Correcta', isCorrect: true },
      { key: 'B', text: 'Distractor', isCorrect: false },
    ]);
    expect(ref.fromNode).toBe('target');
  });

  it('conserva la procedencia de fallback (sibling / ancestor) en referenceItems', async () => {
    const taggedItems: ReferenceItemRef[] = [
      {
        itemId: 'sib-item',
        position: 1,
        type: 'multiple_choice',
        stem: 'Ítem de un hermano',
        alternatives: null,
        correctKey: null,
        explanation: null,
        difficulty: null,
        subjectId: null,
        gradeId: null,
        fromNode: 'sibling',
      },
      {
        itemId: 'anc-item',
        position: 2,
        type: 'multiple_choice',
        stem: 'Ítem de un ancestro',
        alternatives: null,
        correctKey: null,
        explanation: null,
        difficulty: null,
        subjectId: null,
        gradeId: null,
        fromNode: 'ancestor',
      },
    ];
    const service = new RemedialContextService(makeRetriever(makeCtx({ taggedItems })));
    const result = await service.assemble('node-1');

    expect(result.referenceItems!.map((r) => r.fromNode)).toEqual(['sibling', 'ancestor']);
  });

  it('acota referenceItems por tokens (máximo definido)', async () => {
    const many: ReferenceItemRef[] = Array.from({ length: 12 }, (_, i) => ({
      itemId: `i${i}`,
      position: i,
      type: 'multiple_choice',
      stem: `pregunta ${i}`,
      alternatives: null,
      correctKey: null,
      explanation: null,
      difficulty: null,
      subjectId: null,
      gradeId: null,
      fromNode: 'target',
    }));
    const service = new RemedialContextService(
      makeRetriever(makeCtx({ taggedItems: many })),
    );
    const result = await service.assemble('node-1');
    expect(result.referenceItems!.length).toBeLessThanOrEqual(6);
  });

  it('propaga el nodeId y el orgId al retriever', async () => {
    const retriever = makeRetriever(makeCtx());
    const service = new RemedialContextService(retriever);
    await service.assemble('node-xyz', 'org-1');
    expect(retriever.getContext).toHaveBeenCalledWith('node-xyz', 'org-1');
  });

  it('funciona sin orgId (pool completo, aditivo)', async () => {
    const retriever = makeRetriever(makeCtx());
    const service = new RemedialContextService(retriever);
    await service.assemble('node-xyz');
    expect(retriever.getContext).toHaveBeenCalledWith('node-xyz', undefined);
  });

  it('no expone ids internos crudos de descriptores (solo forma legible)', async () => {
    const service = new RemedialContextService(makeRetriever(makeCtx()));
    const result = await service.assemble('node-1');
    expect(result.descriptors[0]).not.toHaveProperty('id');
    expect(result.target).not.toHaveProperty('id');
  });
});
