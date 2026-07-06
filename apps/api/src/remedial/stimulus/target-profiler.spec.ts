import type { FailedStimulus } from './failed-stimulus.service';
import type { ReadabilityFormula, ReadabilityScore } from './readability.formula';
import { TargetProfiler } from './target-profiler';

/** Formula fake determinista: mapea cada texto a un score fijo (aísla la agregación). */
function makeFormula(scores: Record<string, ReadabilityScore>): ReadabilityFormula {
  return { score: (text: string) => scores[text] ?? { value: 0, gradeEstimate: null } };
}

function makeFailed(overrides: Partial<FailedStimulus>): FailedStimulus {
  return {
    sectionId: 's',
    kind: 'passage',
    source: 'official',
    title: null,
    text: 'x',
    textType: 'plain',
    itemPositions: [1],
    gap: 50,
    ...overrides,
  };
}

describe('TargetProfiler', () => {
  it('agrega varios fallados: readability por MEDIANA, largo por rango, grado por mediana', () => {
    const scores: Record<string, ReadabilityScore> = {
      'uno dos tres': { value: 90, gradeEstimate: 2 },
      'uno dos tres cuatro cinco': { value: 80, gradeEstimate: 4 },
      'uno dos tres cuatro cinco seis siete': { value: 50, gradeEstimate: 10 },
    };
    const profiler = new TargetProfiler(makeFormula(scores));

    const profile = profiler.profile([
      makeFailed({ text: 'uno dos tres' }), // 3 palabras
      makeFailed({ text: 'uno dos tres cuatro cinco' }), // 5 palabras
      makeFailed({ text: 'uno dos tres cuatro cinco seis siete' }), // 7 palabras
    ]);

    // Mediana de [90,80,50] = 80 (no el promedio 73.33).
    expect(profile.readabilityTarget).toBe(80);
    // Mediana de [2,4,10] = 4.
    expect(profile.gradeTarget).toBe(4);
    expect(profile.wordCountRange).toEqual([3, 7]);
    // `passage_format` ('plain') no es un género → default.
    expect(profile.textType).toBe('informativo');
  });

  it('sin pasajes con texto → defaults (dificultad media, largo típico, informativo)', () => {
    const profiler = new TargetProfiler(makeFormula({}));

    const profile = profiler.profile([]);

    expect(profile).toEqual({
      readabilityTarget: 70,
      gradeTarget: null,
      wordCountRange: [150, 350],
      textType: 'informativo',
    });
  });

  it('ignora fallados sin texto al perfilar', () => {
    const scores: Record<string, ReadabilityScore> = {
      'hola mundo': { value: 88, gradeEstimate: 4 },
    };
    const profiler = new TargetProfiler(makeFormula(scores));

    const profile = profiler.profile([
      makeFailed({ text: 'hola mundo' }),
      makeFailed({ text: null }),
      makeFailed({ text: '   ' }),
    ]);

    expect(profile.readabilityTarget).toBe(88);
    expect(profile.wordCountRange).toEqual([2, 2]);
  });

  it('propaga un género real de textType cuando no es un token de formato', () => {
    const scores: Record<string, ReadabilityScore> = {
      'texto uno': { value: 70, gradeEstimate: 6 },
      'texto dos': { value: 70, gradeEstimate: 6 },
    };
    const profiler = new TargetProfiler(makeFormula(scores));

    const profile = profiler.profile([
      makeFailed({ text: 'texto uno', textType: 'narrativo' }),
      makeFailed({ text: 'texto dos', textType: 'narrativo' }),
    ]);

    expect(profile.textType).toBe('narrativo');
  });
});
