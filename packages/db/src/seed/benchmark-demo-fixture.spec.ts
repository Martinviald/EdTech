import { demoInstrumentTally, demoSkillTally, withDemoSkillTally } from './benchmark-demo-fixture';

describe('tally del fixture de benchmarking', () => {
  it('reproduce el % del fixture desde el tally', () => {
    const tally = demoInstrumentTally(40, 62.5);
    expect((100 * tally.scoreSum) / tally.maxSum).toBeCloseTo(62.5, 2);
    expect(demoSkillTally(10, 50)).toEqual({ scoreSum: 20, maxSum: 40 });
  });

  it('rellena la habilidad sembrada sin tally y respeta la que ya lo tiene', () => {
    const sinTally = {
      nodeId: 'n',
      nodeName: 'N',
      achievement: 50,
      studentCount: 10,
      scoreSum: 0,
      maxSum: 0,
    };
    expect(withDemoSkillTally(sinTally)).toEqual({ ...sinTally, scoreSum: 20, maxSum: 40 });
    const conTally = { ...sinTally, scoreSum: 7, maxSum: 8 };
    expect(withDemoSkillTally(conTally)).toBe(conTally);
  });

  it('no inventa tally para una habilidad sin %', () => {
    const sinPct = {
      nodeId: 'n',
      nodeName: 'N',
      achievement: null,
      studentCount: 10,
      scoreSum: 0,
      maxSum: 0,
    };
    expect(withDemoSkillTally(sinPct)).toBe(sinPct);
  });
});
