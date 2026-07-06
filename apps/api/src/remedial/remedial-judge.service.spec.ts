import type { RemedialStimulus } from '@soe/types';
import type { LlmService } from '../llm/llm.service';
import type { RemedialJudgeItem } from './remedial.generator';
import { RemedialJudgeService } from './remedial-judge.service';

type LlmMock = LlmService & { completeWithUsage: jest.Mock };

/** LLM que devuelve `texts` en orden (uno por llamada = uno por ítem). */
function makeLlm(...texts: string[]): LlmMock {
  const queue = [...texts];
  return {
    completeWithUsage: jest.fn().mockImplementation(() =>
      Promise.resolve({
        text: queue.shift() ?? texts[texts.length - 1] ?? '{}',
        model: 'gemini-2.5-flash',
        usage: null,
      }),
    ),
  } as unknown as LlmMock;
}

const stimulus: RemedialStimulus = {
  sectionId: 'sec-1',
  kind: 'passage',
  source: 'official',
  title: 'Las abejas',
  text: 'Las abejas producen miel.',
};

function makeItem(overrides: Partial<RemedialJudgeItem> = {}): RemedialJudgeItem {
  return {
    position: 1,
    itemId: 'it-1',
    stem: '¿Qué producen las abejas?',
    alternatives: [
      { key: 'A', text: 'Miel', isCorrect: true },
      { key: 'B', text: 'Lana', isCorrect: false },
      { key: 'C', text: 'Seda', isCorrect: false },
      { key: 'D', text: 'Cera de abeja de otra especie', isCorrect: false },
    ],
    explanation: 'Clave A porque el pasaje afirma que las abejas producen miel.',
    ...overrides,
  };
}

const rawPass = JSON.stringify({
  derivedAnswer: 'A',
  uniqueCorrect: true,
  factual: true,
  skillMatch: true,
  objections: [],
});

describe('RemedialJudgeService', () => {
  it('devuelve un veredicto por ítem con la forma completa (answerable calculado por el service)', async () => {
    const service = new RemedialJudgeService(makeLlm(rawPass));
    const verdicts = await service.judge('org-1', stimulus, [makeItem()]);

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toEqual({
      position: 1,
      answerable: true, // solve-then-check: derived 'A' === clave real 'A'
      derivedAnswer: 'A',
      uniqueCorrect: true,
      factual: true,
      skillMatch: true,
      objections: [],
    });
  });

  it('answerable = solve-then-check: derived ≠ clave real → false + objeción concreta', async () => {
    // El juez elige "B" pero la clave real del ítem es "A".
    const raw = JSON.stringify({
      derivedAnswer: 'B',
      uniqueCorrect: true,
      factual: true,
      skillMatch: true,
      objections: [],
    });
    const service = new RemedialJudgeService(makeLlm(raw));
    const verdicts = await service.judge('org-1', stimulus, [makeItem()]);

    expect(verdicts[0].answerable).toBe(false);
    expect(verdicts[0].derivedAnswer).toBe('B');
    // El service inyecta una objeción accionable (con ambas keys) para la regeneración.
    expect(verdicts[0].objections.some((o) => o.includes('"B"') && o.includes('"A"'))).toBe(true);
  });

  it('derivedAnswer null → no respondible + objeción', async () => {
    const raw = JSON.stringify({
      derivedAnswer: null,
      uniqueCorrect: false,
      factual: true,
      skillMatch: true,
      objections: ['Ninguna alternativa se sostiene desde el texto'],
    });
    const service = new RemedialJudgeService(makeLlm(raw));
    const verdicts = await service.judge('org-1', stimulus, [makeItem()]);

    expect(verdicts[0].answerable).toBe(false);
    expect(verdicts[0].derivedAnswer).toBeNull();
    expect(verdicts[0].objections.some((o) => o.includes('no es respondible'))).toBe(true);
  });

  it('el prompt NO filtra la clave (sin isCorrect, sin explicación, sin marca de correcta) y usa el feature remedial_judge', async () => {
    const llm = makeLlm(rawPass);
    const service = new RemedialJudgeService(llm);
    const item = makeItem();
    await service.judge('org-1', stimulus, [item]);

    const [system, prompt, orgId, feature] = llm.completeWithUsage.mock.calls[0];
    expect(feature).toBe('remedial_judge');
    expect(orgId).toBe('org-1');

    // Anti-filtración: la clave real nunca viaja al LLM.
    expect(prompt).not.toContain('isCorrect');
    expect(prompt).not.toContain('(correcta)');
    expect(prompt).not.toContain(item.explanation); // la explicación revelaría la clave
    // Sí ve la pregunta, TODAS las alternativas y el pasaje (para poder juzgar).
    expect(prompt).toContain(item.stem);
    expect(prompt).toContain('Miel');
    expect(prompt).toContain('Lana');
    expect(prompt).toContain('Las abejas producen miel');
    // El system instruye deducir la clave a ciegas.
    expect(system).toContain('JUEZ');
  });

  it('sin estímulo (self_contained): juzga por razonamiento y no arma bloque de pasaje', async () => {
    const llm = makeLlm(rawPass);
    const service = new RemedialJudgeService(llm);
    const verdicts = await service.judge('org-1', null, [makeItem()]);

    expect(verdicts[0].answerable).toBe(true);
    const prompt = llm.completeWithUsage.mock.calls[0][1];
    expect(prompt).not.toContain('PASAJE');
  });

  it('juzga varios ítems en orden, con solve-then-check independiente por ítem', async () => {
    // Ítem 1: juez deriva 'A' (== clave) → answerable. Ítem 2: deriva 'B' (clave 'A') → no.
    const raw1 = rawPass;
    const raw2 = JSON.stringify({
      derivedAnswer: 'B',
      uniqueCorrect: true,
      factual: true,
      skillMatch: true,
      objections: [],
    });
    const service = new RemedialJudgeService(makeLlm(raw1, raw2));
    const verdicts = await service.judge('org-1', stimulus, [
      makeItem({ position: 1, itemId: 'it-1' }),
      makeItem({ position: 2, itemId: 'it-2' }),
    ]);

    expect(verdicts.map((v) => v.position)).toEqual([1, 2]);
    expect(verdicts[0].answerable).toBe(true);
    expect(verdicts[1].answerable).toBe(false);
  });

  it('lanza si el veredicto del juez no cumple el schema (→ failed en el runner)', async () => {
    const service = new RemedialJudgeService(makeLlm('{"derivedAnswer":"A"}'));
    await expect(service.judge('org-1', stimulus, [makeItem()])).rejects.toThrow(
      /no cumple el schema/,
    );
  });
});
