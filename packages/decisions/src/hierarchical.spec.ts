import type { ChoiceAnswer, DecisionQuestion, Description } from './contracts';
import { FakeDecisionEngine, type FakeAnswer } from './fake/fake-engine';
import { hierarchicalChoice, type DecisionTreeNode } from './hierarchical';

const tree: DecisionTreeNode[] = [
  {
    id: 'mat',
    label: 'Matemática',
    children: [
      { id: 'alg', label: 'Álgebra' },
      {
        id: 'geo',
        label: 'Geometría',
        description: 'Figuras, áreas y volúmenes',
        children: [
          { id: 'area', label: 'Área' },
          { id: 'vol', label: 'Volumen' },
        ],
      },
    ],
  },
  { id: 'len', label: 'Lenguaje' },
];

function labelOf(description: Description | null): string | undefined {
  if (typeof description === 'string') return description;
  if (
    description !== null &&
    !Array.isArray(description) &&
    typeof description.label === 'string'
  ) {
    return description.label;
  }
  return undefined;
}

/** Elige la opción cuyo label está en `confidenceByLabel`, con esa confianza. */
function pickByLabel(confidenceByLabel: Record<string, number>): FakeAnswer {
  return (_state, question: DecisionQuestion): ChoiceAnswer => {
    if (question.type !== 'choice') throw new Error('se esperaba una pregunta choice');
    const entries = Object.entries(question.criteria);
    const hit = entries.find(([, d]) => {
      const label = labelOf(d);
      return label !== undefined && label in confidenceByLabel;
    });
    if (hit === undefined) throw new Error('ninguna opción calza con el test');
    const [key, description] = hit;
    const probabilities: Record<string, number> = {};
    for (const [k] of entries) probabilities[k] = k === key ? 1 : 0;
    return {
      type: 'choice',
      choice: key,
      probabilities,
      confidence: confidenceByLabel[labelOf(description) ?? ''] ?? 0,
    };
  };
}

describe('hierarchicalChoice', () => {
  it('baja hasta una hoja', async () => {
    const engine = new FakeDecisionEngine({
      answers: { node: pickByLabel({ Matemática: 0.9, Geometría: 0.8, Volumen: 0.7 }) },
    });

    const result = await hierarchicalChoice(engine, {
      state: 'cubo de lado 3',
      instructions: '¿Qué tema?',
      tree,
      minConfidence: 0.6,
    });

    expect(result).toEqual({
      path: [
        { id: 'mat', confidence: 0.9 },
        { id: 'geo', confidence: 0.8 },
        { id: 'vol', confidence: 0.7 },
      ],
      stoppedBecause: 'leaf',
    });
    expect(engine.calls).toHaveLength(3);
  });

  it('usa claves opacas y manda label + descripción al modelo', async () => {
    const engine = new FakeDecisionEngine({
      answers: { node: pickByLabel({ Matemática: 0.9, Geometría: 0.9, Área: 0.9 }) },
    });
    await hierarchicalChoice(engine, {
      state: 's',
      instructions: '¿Qué tema?',
      tree,
      minConfidence: 0.5,
      model: 'jev-x',
    });

    const second = engine.calls[1];
    expect(second?.model).toBe('jev-x');
    expect(second?.questions.node).toEqual({
      type: 'choice',
      instructions: '¿Qué tema?',
      criteria: {
        c0: 'Álgebra',
        c1: { label: 'Geometría', description: 'Figuras, áreas y volúmenes' },
      },
    });
  });

  it('se detiene por baja confianza sin incluir ese nodo en el path', async () => {
    const engine = new FakeDecisionEngine({
      answers: { node: pickByLabel({ Matemática: 0.9, Geometría: 0.3 }) },
    });

    const result = await hierarchicalChoice(engine, {
      state: 's',
      instructions: '?',
      tree,
      minConfidence: 0.5,
    });

    expect(result).toEqual({
      path: [{ id: 'mat', confidence: 0.9 }],
      stoppedBecause: 'low_confidence',
    });
  });

  it('devuelve un path vacío si la raíz ya es de baja confianza', async () => {
    const engine = new FakeDecisionEngine({ answers: { node: pickByLabel({ Lenguaje: 0.2 }) } });
    const result = await hierarchicalChoice(engine, {
      state: 's',
      instructions: '?',
      tree,
      minConfidence: 0.5,
    });
    expect(result).toEqual({ path: [], stoppedBecause: 'low_confidence' });
  });

  it('no llama al motor en un nivel con un solo nodo', async () => {
    const engine = new FakeDecisionEngine({ answers: { node: pickByLabel({ Álgebra: 0.95 }) } });
    const single: DecisionTreeNode[] = [
      { id: 'solo', label: 'Solo', children: tree[0]?.children ?? [] },
    ];

    const result = await hierarchicalChoice(engine, {
      state: 's',
      instructions: '?',
      tree: single,
      minConfidence: 0.5,
    });

    expect(result.path).toEqual([
      { id: 'solo', confidence: 1 },
      { id: 'alg', confidence: 0.95 },
    ]);
    expect(engine.calls).toHaveLength(1);
  });

  it('rechaza más de 255 hermanos sin llamar al motor', async () => {
    const engine = new FakeDecisionEngine();
    const wide: DecisionTreeNode[] = Array.from({ length: 256 }, (_, i) => ({
      id: `n${i}`,
      label: `Nodo ${i}`,
    }));

    await expect(
      hierarchicalChoice(engine, { state: 's', instructions: '?', tree: wide, minConfidence: 0.5 }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(engine.calls).toHaveLength(0);
  });

  it('rechaza un árbol vacío, ids repetidos y minConfidence fuera de rango', async () => {
    const engine = new FakeDecisionEngine();
    const base = { state: 's', instructions: '?', minConfidence: 0.5 };

    await expect(hierarchicalChoice(engine, { ...base, tree: [] })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(
      hierarchicalChoice(engine, {
        ...base,
        tree: [
          { id: 'a', label: 'A' },
          { id: 'a', label: 'B' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      hierarchicalChoice(engine, { ...base, tree, minConfidence: 1.5 }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });
});
