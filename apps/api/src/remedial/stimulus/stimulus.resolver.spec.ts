import type { Database } from '@soe/db';
import type { RemedialStimulusRef } from '@soe/types';
import type { FailedStimulus } from './failed-stimulus.service';
import { FailedStimulusService } from './failed-stimulus.service';
import type {
  GenerateStimulusProvider,
  GeneratedStimulus,
} from './generate-stimulus.provider';
import type { PassageSelectionPolicy } from './passage-selection.policy';
import type { TerminalFallbackPolicy } from './terminal-fallback.policy';
import { StimulusResolver } from './stimulus.resolver';

/** Mock de `Database` para `loadPassage`: la cadena resuelve `rows` una vez. */
function makeDb(rows: unknown[]): Database {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'limit']) {
    chain[m] = () => chain;
  }
  (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve);
  return { select: () => chain } as unknown as Database;
}

function makeDeps(): {
  failed: { list: jest.Mock };
  generate: { generate: jest.Mock };
  policy: { select: jest.Mock };
  fallback: { fallback: jest.Mock };
} {
  return {
    failed: { list: jest.fn() },
    generate: { generate: jest.fn() },
    policy: { select: jest.fn() },
    fallback: { fallback: jest.fn() },
  };
}

function makeResolver(
  deps: ReturnType<typeof makeDeps>,
  db: Database,
): StimulusResolver {
  return new StimulusResolver(
    db,
    deps.failed as unknown as FailedStimulusService,
    deps.generate as unknown as GenerateStimulusProvider,
    deps.policy as unknown as PassageSelectionPolicy,
    deps.fallback as unknown as TerminalFallbackPolicy,
  );
}

const candidate: FailedStimulus = {
  sectionId: 'S1',
  kind: 'passage',
  source: 'official',
  title: 'T1',
  text: 'texto completo del pasaje',
  textType: 'plain',
  itemPositions: [1, 2],
  gap: 80,
};

const ref: RemedialStimulusRef = {
  sectionId: 'S1',
  kind: 'passage',
  source: 'official',
  title: 'T1',
  textPreview: 'texto completo del pasaje',
};

describe('StimulusResolver', () => {
  it('method != reuse_stimulus → self_contained sin tocar nada', async () => {
    const deps = makeDeps();
    const resolver = makeResolver(deps, makeDb([]));

    const result = await resolver.resolve({
      orgId: 'o',
      assessmentId: 'a',
      nodeId: 'n',
      method: 'self_contained',
    });

    expect(result).toEqual({ method: 'self_contained', stimulus: null });
    expect(deps.failed.list).not.toHaveBeenCalled();
    expect(deps.fallback.fallback).not.toHaveBeenCalled();
  });

  it('generate_stimulus → GenerateStimulusProvider (Opción B), propaga readability', async () => {
    const deps = makeDeps();
    const generated: GeneratedStimulus = {
      method: 'generate_stimulus',
      stimulus: {
        sectionId: 'GEN1',
        kind: 'passage',
        source: 'ai_generated',
        title: 'Texto nuevo',
        text: 'Un texto original generado por IA.',
      },
      readability: {
        value: 72,
        gradeEstimate: 6,
        target: 70,
        gradeTarget: 6,
        withinBand: true,
        wordCount: 6,
        wordCountRange: [1, 100],
        textType: 'informativo',
        warning: null,
        promptVersion: 'ola2-generate-stimulus-v1',
      },
    };
    deps.generate.generate.mockResolvedValue(generated);
    const resolver = makeResolver(deps, makeDb([]));

    const result = await resolver.resolve({
      orgId: 'o',
      assessmentId: 'a',
      nodeId: 'n',
      method: 'generate_stimulus',
      // El picker no aplica en B: el stimulusId se ignora.
      stimulusId: 'ignored',
    });

    expect(deps.generate.generate).toHaveBeenCalledWith({
      orgId: 'o',
      assessmentId: 'a',
      nodeId: 'n',
    });
    expect(result.method).toBe('generate_stimulus');
    expect(result.stimulus).toEqual(generated.stimulus);
    expect(result.readability).toEqual(generated.readability);
    // No pasa por la cadena de la Opción A.
    expect(deps.failed.list).not.toHaveBeenCalled();
    expect(deps.fallback.fallback).not.toHaveBeenCalled();
  });

  it('reuse_stimulus con stimulusId → carga y valida esa sección (override)', async () => {
    const deps = makeDeps();
    const db = makeDb([
      {
        id: 'S5',
        kind: 'passage',
        source: 'official',
        passageTitle: 'T5',
        passageText: 'texto de la sección elegida',
      },
    ]);
    const resolver = makeResolver(deps, db);

    const result = await resolver.resolve({
      orgId: 'o',
      assessmentId: 'a',
      nodeId: 'n',
      method: 'reuse_stimulus',
      stimulusId: 'S5',
    });

    expect(result).toEqual({
      method: 'reuse_stimulus',
      stimulus: {
        sectionId: 'S5',
        kind: 'passage',
        source: 'official',
        title: 'T5',
        text: 'texto de la sección elegida',
      },
    });
    // No consulta pasajes fallados cuando hay override explícito.
    expect(deps.failed.list).not.toHaveBeenCalled();
  });

  it('reuse_stimulus con stimulusId inexistente → NotFoundException', async () => {
    const deps = makeDeps();
    const resolver = makeResolver(deps, makeDb([])); // sección no encontrada

    await expect(
      resolver.resolve({
        orgId: 'o',
        assessmentId: 'a',
        nodeId: 'n',
        method: 'reuse_stimulus',
        stimulusId: 'missing',
      }),
    ).rejects.toThrow('Estímulo no encontrado');
  });

  it('reuse_stimulus sin stimulusId → pasaje de mayor brecha (auto)', async () => {
    const deps = makeDeps();
    deps.failed.list.mockResolvedValue([candidate]);
    deps.policy.select.mockReturnValue([ref]);
    const resolver = makeResolver(deps, makeDb([]));

    const result = await resolver.resolve({
      orgId: 'o',
      assessmentId: 'a',
      nodeId: 'n',
      method: 'reuse_stimulus',
    });

    // El estímulo final trae el TEXTO COMPLETO del candidato (no el preview).
    expect(result).toEqual({
      method: 'reuse_stimulus',
      stimulus: {
        sectionId: 'S1',
        kind: 'passage',
        source: 'official',
        title: 'T1',
        text: 'texto completo del pasaje',
      },
    });
    expect(deps.policy.select).toHaveBeenCalledWith([candidate]);
    expect(deps.fallback.fallback).not.toHaveBeenCalled();
  });

  it('reuse_stimulus sin pasajes fallados → fallback terminal (self_contained)', async () => {
    const deps = makeDeps();
    deps.failed.list.mockResolvedValue([]);
    deps.fallback.fallback.mockResolvedValue({ method: 'self_contained', stimulus: null });
    const resolver = makeResolver(deps, makeDb([]));

    const result = await resolver.resolve({
      orgId: 'o',
      assessmentId: 'a',
      nodeId: 'n',
      method: 'reuse_stimulus',
    });

    expect(result).toEqual({ method: 'self_contained', stimulus: null });
    expect(deps.fallback.fallback).toHaveBeenCalledWith({
      orgId: 'o',
      assessmentId: 'a',
      nodeId: 'n',
    });
  });
});
