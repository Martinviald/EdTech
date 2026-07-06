import type { Database } from '@soe/db';
import type { LlmService } from '../../llm/llm.service';
import type { FailedStimulus, FailedStimulusService } from './failed-stimulus.service';
import { GenerateStimulusProvider } from './generate-stimulus.provider';
import type { ReadabilityFormula, ReadabilityScore } from './readability.formula';
import type { StimulusTargetProfile, TargetProfiler } from './target-profiler';

const NODE_ROW = { name: 'Interpretar el sentido global', code: 'OA6', description: 'Comprensión' };
const SECTION_ID = '99999999-9999-4999-8999-999999999999';

const GENERATED = {
  title: 'Los faros del sur',
  text: 'Este es un texto de prueba con varias palabras adentro para medir.',
};

const PROFILE: StimulusTargetProfile = {
  readabilityTarget: 70,
  gradeTarget: 6,
  wordCountRange: [1, 100],
  textType: 'informativo',
};

const FAILED: FailedStimulus = {
  sectionId: 'failed-1',
  kind: 'passage',
  source: 'official',
  title: 'Las abejas',
  text: 'Las abejas polinizan las flores y producen miel en la colmena.',
  textType: 'plain',
  itemPositions: [1, 2],
  gap: 80,
};

type DbMock = Database & { __inserted: Array<Record<string, unknown>> };

function makeDb(): DbMock {
  const inserted: Array<Record<string, unknown>> = [];
  const selectChain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'limit']) {
    selectChain[m] = () => selectChain;
  }
  (selectChain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve([NODE_ROW]).then(resolve);

  return {
    select: () => selectChain,
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          returning: () =>
            Promise.resolve([
              { id: SECTION_ID, passageTitle: row.passageTitle, passageText: row.passageText },
            ]),
        };
      },
    }),
    __inserted: inserted,
  } as unknown as DbMock;
}

function makeLlm(response: string): LlmService {
  return {
    completeWithUsage: jest.fn().mockResolvedValue({
      text: response,
      model: 'gemini-2.5-pro',
      usage: { inputTokens: 200, outputTokens: 300 },
    }),
  } as unknown as LlmService;
}

function makeDeps(measured: ReadabilityScore = { value: 72, gradeEstimate: 6 }) {
  return {
    failed: { list: jest.fn().mockResolvedValue([FAILED]) } as unknown as FailedStimulusService,
    profiler: { profile: jest.fn().mockReturnValue(PROFILE) } as unknown as TargetProfiler,
    readability: { score: jest.fn().mockReturnValue(measured) } as unknown as ReadabilityFormula,
  };
}

describe('GenerateStimulusProvider', () => {
  it('genera un estímulo ai_generated: mide targets → Pro → mide → inserta sección', async () => {
    const db = makeDb();
    const llm = makeLlm(JSON.stringify(GENERATED));
    const deps = makeDeps();
    const provider = new GenerateStimulusProvider(
      db,
      llm,
      deps.failed,
      deps.profiler,
      deps.readability,
    );

    const result = await provider.generate({ orgId: 'org-1', assessmentId: 'a-1', nodeId: 'n-1' });

    // Recupera los fallados (grounding) y perfila el target.
    expect(deps.failed.list).toHaveBeenCalledWith('org-1', 'a-1', 'n-1');
    expect(deps.profiler.profile).toHaveBeenCalledWith([FAILED]);

    // Llama a Pro (feature remedial_reading) con un prompt que nombra la habilidad y usa
    // el pasaje fallado como referencia de calibración.
    const call = (llm.completeWithUsage as jest.Mock).mock.calls[0];
    expect(call[2]).toBe('org-1');
    expect(call[3]).toBe('remedial_reading');
    expect(call[1]).toContain('Interpretar el sentido global');
    expect(call[1]).toContain('Las abejas polinizan');

    // Inserta la sección ai_generated con orgId explícito, instrumentId null, passage/plain.
    expect(db.__inserted).toHaveLength(1);
    expect(db.__inserted[0]).toMatchObject({
      orgId: 'org-1',
      instrumentId: null,
      kind: 'passage',
      source: 'ai_generated',
      passageFormat: 'plain',
      passageTitle: 'Los faros del sur',
      passageText: GENERATED.text,
    });

    // Devuelve el estímulo hidratado (source ai_generated) con el texto generado + medición.
    expect(result.method).toBe('generate_stimulus');
    expect(result.stimulus).toEqual({
      sectionId: SECTION_ID,
      kind: 'passage',
      source: 'ai_generated',
      title: 'Los faros del sur',
      text: GENERATED.text,
    });
    expect(result.readability).toMatchObject({
      value: 72,
      gradeEstimate: 6,
      target: 70,
      gradeTarget: 6,
      withinBand: true, // |72 - 70| ≤ 15
      warning: null,
      textType: 'informativo',
    });
    expect(result.readability.wordCount).toBeGreaterThan(0);
  });

  it('legibilidad fuera de banda → aviso blando (no regenera, no bloquea)', async () => {
    const db = makeDb();
    const deps = makeDeps({ value: 40, gradeEstimate: 12 }); // |40 - 70| = 30 > 15
    const provider = new GenerateStimulusProvider(
      db,
      makeLlm(JSON.stringify(GENERATED)),
      deps.failed,
      deps.profiler,
      deps.readability,
    );

    const result = await provider.generate({ orgId: 'o', assessmentId: 'a', nodeId: 'n' });

    // Igual persiste (no bloquea) pero marca fuera de banda con aviso.
    expect(db.__inserted).toHaveLength(1);
    expect(result.readability.withinBand).toBe(false);
    expect(result.readability.warning).toContain('fuera de banda');
  });

  it('lanza si la salida del modelo no es JSON válido (→ failed en el runner)', async () => {
    const deps = makeDeps();
    const provider = new GenerateStimulusProvider(
      makeDb(),
      makeLlm('esto no es json'),
      deps.failed,
      deps.profiler,
      deps.readability,
    );

    await expect(
      provider.generate({ orgId: 'o', assessmentId: 'a', nodeId: 'n' }),
    ).rejects.toThrow(/no es JSON/);
  });

  it('lanza si el JSON no cumple el schema (falta text)', async () => {
    const deps = makeDeps();
    const provider = new GenerateStimulusProvider(
      makeDb(),
      makeLlm(JSON.stringify({ title: 'Sin cuerpo' })),
      deps.failed,
      deps.profiler,
      deps.readability,
    );

    await expect(
      provider.generate({ orgId: 'o', assessmentId: 'a', nodeId: 'n' }),
    ).rejects.toThrow(/no cumple el schema/);
  });
});
