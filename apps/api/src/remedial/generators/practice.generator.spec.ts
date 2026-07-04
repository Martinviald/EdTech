import type { Database, RemedialMaterial } from '@soe/db';
import type { LlmService } from '../../llm/llm.service';
import type { RemedialCurriculumContext } from '../remedial-context.service';
import type { RemedialGenerationInput } from '../remedial.generator';
import { PracticeGenerator } from './practice.generator';

function makeCurriculum(): RemedialCurriculumContext {
  return {
    nodeId: 'node-1',
    target: { code: 'OA3', name: 'Fracciones', description: null, type: 'learning_objective' },
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
      classGroupId: null,
      createdById: 'user-1',
      input: { itemCount: 2 },
      ...overrides,
    } as RemedialMaterial,
    orgId: 'org-1',
    curriculum: makeCurriculum(),
  };
}

function makeLlm(response: string): LlmService {
  return {
    completeWithUsage: jest.fn().mockResolvedValue({
      text: response,
      model: 'gemini-2.5-flash',
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  } as unknown as LlmService;
}

type DbMock = Database & { __inserted: Array<Record<string, unknown>> };

function makeDb(): DbMock {
  const inserted: Array<Record<string, unknown>> = [];
  let insertCall = 0;
  const db = {
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => {
        rows.forEach((r) => inserted.push(r));
        insertCall++;
        // primer insert (items) devuelve filas con id; el segundo (tags) no necesita returning
        const ret =
          insertCall === 1
            ? rows.map((r, i) => ({
                ...r,
                id: `0000000${i + 1}-0000-4000-8000-000000000000`,
              }))
            : rows.map((r) => ({ ...r }));
        return { returning: () => Promise.resolve(ret) };
      },
    }),
    execute: async () => [],
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    __inserted: inserted,
  } as unknown as DbMock;
  return db;
}

const twoItems = {
  skillFocus: 'fracciones equivalentes',
  notes: 'practicar en casa',
  items: [
    {
      stem: '¿Cuál es equivalente a 1/2?',
      alternatives: [
        { key: 'A', text: '2/4', isCorrect: true },
        { key: 'B', text: '1/3', isCorrect: false },
        { key: 'C', text: '2/3', isCorrect: false },
        { key: 'D', text: '3/4', isCorrect: false },
      ],
      explanation: '2/4 simplifica a 1/2',
    },
    {
      stem: '¿Cuál es mayor: 1/2 o 1/4?',
      alternatives: [
        { key: 'A', text: '1/2', isCorrect: true },
        { key: 'B', text: '1/4', isCorrect: false },
      ],
      explanation: '1/2 > 1/4',
    },
  ],
};

describe('PracticeGenerator', () => {
  it('inserta ítems draft (ai_generated) en batch y linkea por tags', async () => {
    const db = makeDb();
    const gen = new PracticeGenerator(makeLlm(JSON.stringify(twoItems)), db);
    const result = await gen.generate(makeInput());

    expect(result.promptVersion).toBe('ola1-practice-v2');
    // 2 items + 2 tags
    const itemInserts = db.__inserted.filter((r) => 'source' in r);
    expect(itemInserts).toHaveLength(2);
    expect(itemInserts[0]).toMatchObject({
      source: 'ai_generated',
      status: 'draft',
      instrumentId: null,
    });

    const tagInserts = db.__inserted.filter((r) => 'taggedBy' in r);
    expect(tagInserts).toHaveLength(2);
    expect(tagInserts[0]).toMatchObject({ taggedBy: 'ai', nodeId: 'node-1' });
  });

  it('el content guarda referencias (itemId/position/stem), no el content del ítem', async () => {
    const db = makeDb();
    const gen = new PracticeGenerator(makeLlm(JSON.stringify(twoItems)), db);
    const result = await gen.generate(makeInput());

    expect(result.content).toMatchObject({ itemCount: 2 });
    if ('items' in result.content) {
      expect(result.content.items).toHaveLength(2);
      expect(result.content.items[0]).toMatchObject({
        itemId: '00000001-0000-4000-8000-000000000000',
        position: 1,
      });
      expect(result.content.items[0]).not.toHaveProperty('alternatives');
    }
  });

  it('lanza si la salida no es JSON (→ failed en el runner)', async () => {
    const gen = new PracticeGenerator(makeLlm('???'), makeDb());
    await expect(gen.generate(makeInput())).rejects.toThrow(/no es JSON/);
  });

  it('lanza si el set no cumple el schema', async () => {
    const gen = new PracticeGenerator(makeLlm(JSON.stringify({ items: [] })), makeDb());
    await expect(gen.generate(makeInput())).rejects.toThrow(/no cumple el schema/);
  });

  it('lanza si el material no tiene nodeId', async () => {
    const gen = new PracticeGenerator(makeLlm(JSON.stringify(twoItems)), makeDb());
    const input = makeInput();
    (input.material as { nodeId: string | null }).nodeId = null;
    await expect(gen.generate(input)).rejects.toThrow(/nodeId/);
  });

  it('modo estímulo: ancla al pasaje (feature remedial_reading, sectionId, content.stimuli)', async () => {
    const db = makeDb();
    const llm = makeLlm(JSON.stringify(twoItems));
    const gen = new PracticeGenerator(llm, db);
    const stimulus = {
      sectionId: '99999999-9999-4999-8999-999999999999',
      kind: 'passage' as const,
      source: 'official' as const,
      title: 'Las abejas',
      text: 'Las abejas polinizan las flores y producen miel.',
    };
    const result = await gen.generate({ ...makeInput(), stimulus });

    // usa el prompt anclado (versión propia, no la self_contained).
    expect(result.promptVersion).toBe('ola2-practice-stimulus-v1');

    // llama al LLM con la feature Pro y un prompt que incluye el TEXTO del pasaje.
    const call = (llm.completeWithUsage as jest.Mock).mock.calls[0];
    expect(call[3]).toBe('remedial_reading');
    expect(call[1]).toContain('Las abejas polinizan las flores');

    // los ítems quedan ligados al pasaje (sectionId, no null).
    const itemInserts = db.__inserted.filter((r) => 'source' in r);
    expect(itemInserts).toHaveLength(2);
    expect(itemInserts[0]).toMatchObject({ sectionId: stimulus.sectionId });

    // content.stimuli trae la ref ligera del pasaje (preview, sin el texto completo).
    if ('stimuli' in result.content) {
      expect(result.content.stimuli).toHaveLength(1);
      expect(result.content.stimuli[0]).toMatchObject({
        sectionId: stimulus.sectionId,
        kind: 'passage',
        source: 'official',
        title: 'Las abejas',
      });
    }
  });

  it('modo self_contained: sin estímulo → feature remedial, sectionId null, stimuli vacío', async () => {
    const db = makeDb();
    const llm = makeLlm(JSON.stringify(twoItems));
    const gen = new PracticeGenerator(llm, db);
    const result = await gen.generate(makeInput());

    expect(result.promptVersion).toBe('ola1-practice-v2');
    const call = (llm.completeWithUsage as jest.Mock).mock.calls[0];
    expect(call[3]).toBe('remedial');

    const itemInserts = db.__inserted.filter((r) => 'source' in r);
    expect(itemInserts[0]).toMatchObject({ sectionId: null });
    if ('stimuli' in result.content) {
      expect(result.content.stimuli).toEqual([]);
    }
  });

  it('devuelve judgeItems (Ola 2.1b) con la clave real y la explicación, ligados al itemId insertado', async () => {
    const db = makeDb();
    const gen = new PracticeGenerator(makeLlm(JSON.stringify(twoItems)), db);
    const result = await gen.generate(makeInput());

    expect(result.judgeItems).toHaveLength(2);
    expect(result.judgeItems![0]).toEqual({
      position: 1,
      itemId: '00000001-0000-4000-8000-000000000000',
      stem: '¿Cuál es equivalente a 1/2?',
      alternatives: [
        { key: 'A', text: '2/4', isCorrect: true }, // la clave real viaja al juez-service (no al LLM)
        { key: 'B', text: '1/3', isCorrect: false },
        { key: 'C', text: '2/3', isCorrect: false },
        { key: 'D', text: '3/4', isCorrect: false },
      ],
      explanation: '2/4 simplifica a 1/2',
    });
  });

  it('modo regeneración: inyecta el feedback del juez en el prompt (EVITA ESTOS PROBLEMAS)', async () => {
    const db = makeDb();
    const llm = makeLlm(JSON.stringify(twoItems));
    const gen = new PracticeGenerator(llm, db);
    await gen.generate({ ...makeInput(), feedback: ['La pregunta 1 no es respondible desde el texto'] });

    const prompt = (llm.completeWithUsage as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('EVITA ESTOS PROBLEMAS DETECTADOS');
    expect(prompt).toContain('La pregunta 1 no es respondible desde el texto');
  });
});
