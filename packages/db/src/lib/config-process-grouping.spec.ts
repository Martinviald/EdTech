import {
  buildConfigProcessName,
  groupCandidatesByConfigValue,
  type ConfigProcessCandidate,
} from './config-process-grouping';

const ORG = 'org-1';
const YEAR_2026 = 'year-2026';

function candidate(overrides: Partial<ConfigProcessCandidate>): ConfigProcessCandidate {
  return {
    assessmentId: 'a1',
    orgId: ORG,
    academicYearId: YEAR_2026,
    instrumentId: 'i1',
    instrumentType: 'paes',
    applicationPeriod: null,
    gradeId: 'g-iv',
    subjectId: 's-math',
    trackId: null,
    configValue: '1',
    year: 2026,
    classGroupId: 'cg-a',
    administeredOn: '2026-03-17',
    taxonomyId: 'tax-paes',
    ...overrides,
  };
}

describe('groupCandidatesByConfigValue', () => {
  it('creates one process per tanda and keeps M1 and M2 of the same tanda together', () => {
    const { plans, ambiguous } = groupCandidatesByConfigValue([
      candidate({ assessmentId: 'e1-m1-a', instrumentId: 'm1-e1', trackId: 't-m1' }),
      candidate({
        assessmentId: 'e1-m1-b',
        instrumentId: 'm1-e1',
        trackId: 't-m1',
        classGroupId: 'cg-b',
      }),
      candidate({
        assessmentId: 'e3-m1',
        instrumentId: 'm1-e3',
        trackId: 't-m1',
        configValue: '3',
        administeredOn: '2026-05-20',
      }),
      candidate({
        assessmentId: 'e3-m2',
        instrumentId: 'm2-e3',
        trackId: 't-m2',
        configValue: '3',
        administeredOn: '2026-05-21',
      }),
      candidate({
        assessmentId: 'e3-cl',
        instrumentId: 'cl-e3',
        subjectId: 's-lang',
        configValue: '3',
        administeredOn: '2026-05-20',
      }),
    ]);

    expect(ambiguous).toEqual([]);
    expect(plans.map((plan) => [plan.name, plan.assessmentIds])).toEqual([
      ['Ensayo PAES 1 2026', ['e1-m1-a', 'e1-m1-b']],
      ['Ensayo PAES 3 2026', ['e3-cl', 'e3-m1', 'e3-m2']],
    ]);
    const tanda3 = plans[1]!;
    expect(tanda3).toMatchObject({
      slug: 'ensayo-paes-3-2026',
      kind: 'paes_ensayo',
      period: null,
      taxonomyId: 'tax-paes',
      startsOn: '2026-05-20',
      endsOn: '2026-05-21',
    });
    expect(tanda3.expectedScope).toMatchObject({ derived: true, excludedCells: [] });
  });

  it('leaves ambiguous a tanda with two instruments for the same grade and test', () => {
    const { plans, ambiguous } = groupCandidatesByConfigValue([
      candidate({ assessmentId: 'bio', instrumentId: 'cie-bio', subjectId: 's-sci' }),
      candidate({ assessmentId: 'fis', instrumentId: 'cie-fis', subjectId: 's-sci' }),
    ]);

    expect(plans).toEqual([]);
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]?.violations[0]?.instrumentIds).toEqual(['cie-bio', 'cie-fis']);
  });

  it('separates years and skips assessments spanning more than one year', () => {
    const { plans, multiYearAssessmentIds } = groupCandidatesByConfigValue([
      candidate({ assessmentId: 'a-2025', academicYearId: 'year-2025', year: 2025 }),
      candidate({ assessmentId: 'a-2026' }),
      candidate({ assessmentId: 'split', classGroupId: 'cg-x' }),
      candidate({
        assessmentId: 'split',
        classGroupId: 'cg-y',
        academicYearId: 'year-2025',
        year: 2025,
      }),
    ]);

    expect(multiYearAssessmentIds).toEqual(['split']);
    expect(plans.map((plan) => plan.name).sort()).toEqual([
      'Ensayo PAES 1 2025',
      'Ensayo PAES 1 2026',
    ]);
  });

  it('records the cells that were never applied as excluded', () => {
    const { plans } = groupCandidatesByConfigValue([
      candidate({ assessmentId: 'm', classGroupId: 'cg-a', subjectId: 's-math' }),
      candidate({
        assessmentId: 'l',
        instrumentId: 'i2',
        classGroupId: 'cg-b',
        subjectId: 's-lang',
      }),
    ]);

    expect(plans[0]?.expectedScope.excludedCells).toEqual([
      { classGroupId: 'cg-a', subjectId: 's-lang' },
      { classGroupId: 'cg-b', subjectId: 's-math' },
    ]);
  });
});

describe('buildConfigProcessName', () => {
  it('uses the instrument type label', () => {
    expect(buildConfigProcessName('simce', '2', 2027)).toBe('Ensayo SIMCE 2 2027');
  });
});
