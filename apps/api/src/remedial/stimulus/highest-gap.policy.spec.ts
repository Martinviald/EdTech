import type { FailedStimulus } from './failed-stimulus.service';
import { HighestGapPolicy } from './highest-gap.policy';

function makeCandidate(overrides: Partial<FailedStimulus>): FailedStimulus {
  return {
    sectionId: 'S1',
    kind: 'passage',
    source: 'official',
    title: 'T1',
    text: 'texto',
    textType: 'plain',
    itemPositions: [1],
    gap: 50,
    ...overrides,
  };
}

describe('HighestGapPolicy', () => {
  const policy = new HighestGapPolicy();
  const candidates: FailedStimulus[] = [
    makeCandidate({ sectionId: 'S1', title: 'T1', text: 'texto uno', gap: 80 }),
    makeCandidate({ sectionId: 'S2', title: 'T2', text: 'texto dos', gap: 40 }),
  ];

  it('default: el pasaje de mayor brecha (candidates[0]) como ref con preview', () => {
    expect(policy.select(candidates)).toEqual([
      {
        sectionId: 'S1',
        kind: 'passage',
        source: 'official',
        title: 'T1',
        textPreview: 'texto uno',
      },
    ]);
  });

  it('override: respeta la sección elegida por el docente', () => {
    expect(policy.select(candidates, 'S2')).toEqual([
      {
        sectionId: 'S2',
        kind: 'passage',
        source: 'official',
        title: 'T2',
        textPreview: 'texto dos',
      },
    ]);
  });

  it('override fuera de los candidatos → [] (el caller decide el fallback)', () => {
    expect(policy.select(candidates, 'S9')).toEqual([]);
  });

  it('sin candidatos → []', () => {
    expect(policy.select([])).toEqual([]);
  });
});
