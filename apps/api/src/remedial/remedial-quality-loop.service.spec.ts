import type { JudgeVerdict } from '@soe/types';
import type { RemedialJudgeItem } from './remedial.generator';
import {
  RemedialQualityLoop,
  hasHardFailure,
  objectionsFrom,
} from './remedial-quality-loop.service';

/** Batch mínimo que el loop sabe manejar: `judgeItems` + un tag para verificar identidad. */
interface TestBatch {
  judgeItems: RemedialJudgeItem[];
  tag: string;
}

function makeBatch(tag: string): TestBatch {
  return {
    tag,
    judgeItems: [
      {
        position: 1,
        itemId: tag,
        stem: 'q',
        alternatives: [{ key: 'A', text: 'a', isCorrect: true }],
        explanation: null,
      },
    ],
  };
}

const pass: JudgeVerdict = {
  position: 1,
  answerable: true,
  derivedAnswer: 'A',
  uniqueCorrect: true,
  factual: true,
  skillMatch: true,
  objections: [],
};

/** Falla SOLO blanda (skillMatch): NO debe gatillar regeneración. */
const softOnly: JudgeVerdict = {
  ...pass,
  skillMatch: false,
  objections: ['No mide exactamente la habilidad esperada'],
};

/** Falla DURA (no respondible): gatilla regeneración. */
const hardFail: JudgeVerdict = {
  position: 1,
  answerable: false,
  derivedAnswer: 'B',
  uniqueCorrect: true,
  factual: true,
  skillMatch: true,
  objections: ['obj-answerable'],
};

describe('RemedialQualityLoop', () => {
  const loop = new RemedialQualityLoop();

  it('converge sin fallas: 1 ronda, sin soft-delete', async () => {
    const b0 = makeBatch('b0');
    const generate = jest.fn().mockResolvedValue(b0);
    const judge = jest.fn().mockResolvedValue([pass]);
    const softDeletePrevious = jest.fn().mockResolvedValue(undefined);

    const res = await loop.run({ generate, judge, softDeletePrevious });

    expect(res.qualityReport).toEqual({
      iterations: 1,
      finalStatus: 'converged',
      verdicts: [pass],
    });
    expect(res.finalBatch).toBe(b0);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(undefined); // ronda 0 sin feedback
    expect(judge).toHaveBeenCalledTimes(1);
    expect(softDeletePrevious).not.toHaveBeenCalled();
  });

  it('exhausted tras 3 rondas: soft-delete de las 2 previas + feedback inyectado', async () => {
    const batches = [makeBatch('b0'), makeBatch('b1'), makeBatch('b2')];
    let i = 0;
    const generate = jest.fn().mockImplementation(() => Promise.resolve(batches[Math.min(i++, 2)]));
    const judge = jest.fn().mockResolvedValue([hardFail]);
    const softDeletePrevious = jest.fn().mockResolvedValue(undefined);

    const res = await loop.run({ generate, judge, softDeletePrevious, maxIter: 3 });

    expect(res.qualityReport.iterations).toBe(3);
    expect(res.qualityReport.finalStatus).toBe('exhausted');
    expect(res.qualityReport.verdicts).toEqual([hardFail]); // último veredicto por ítem
    expect(res.finalBatch).toBe(batches[2]);

    expect(generate).toHaveBeenCalledTimes(3);
    expect(judge).toHaveBeenCalledTimes(3);
    // Ronda 0 sin feedback; regeneraciones con las objeciones del juez.
    expect(generate).toHaveBeenNthCalledWith(1, undefined);
    expect(generate).toHaveBeenNthCalledWith(2, ['obj-answerable']);
    expect(generate).toHaveBeenNthCalledWith(3, ['obj-answerable']);

    // Soft-delete de las rondas descartadas (b0 y b1), nunca la final (b2).
    expect(softDeletePrevious).toHaveBeenCalledTimes(2);
    expect(softDeletePrevious).toHaveBeenNthCalledWith(1, batches[0]);
    expect(softDeletePrevious).toHaveBeenNthCalledWith(2, batches[1]);
  });

  it('converge tras 1 regeneración: 2 rondas, 1 soft-delete', async () => {
    const batches = [makeBatch('b0'), makeBatch('b1')];
    let i = 0;
    const generate = jest.fn().mockImplementation(() => Promise.resolve(batches[Math.min(i++, 1)]));
    const judge = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve([hardFail]))
      .mockImplementation(() => Promise.resolve([pass]));
    const softDeletePrevious = jest.fn().mockResolvedValue(undefined);

    const res = await loop.run({ generate, judge, softDeletePrevious });

    expect(res.qualityReport).toEqual({
      iterations: 2,
      finalStatus: 'converged',
      verdicts: [pass],
    });
    expect(res.finalBatch).toBe(batches[1]);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(softDeletePrevious).toHaveBeenCalledTimes(1);
    expect(softDeletePrevious).toHaveBeenCalledWith(batches[0]);
  });

  it('skillMatch=false (blando) NO regenera: converge en 1 ronda mostrando el aviso', async () => {
    const b0 = makeBatch('b0');
    const generate = jest.fn().mockResolvedValue(b0);
    const judge = jest.fn().mockResolvedValue([softOnly]);
    const softDeletePrevious = jest.fn().mockResolvedValue(undefined);

    const res = await loop.run({ generate, judge, softDeletePrevious });

    expect(res.qualityReport).toEqual({
      iterations: 1,
      finalStatus: 'converged',
      verdicts: [softOnly],
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(softDeletePrevious).not.toHaveBeenCalled();
  });
});

describe('hasHardFailure', () => {
  it('true si algún veredicto tiene !answerable / !uniqueCorrect / !factual', () => {
    expect(hasHardFailure([pass])).toBe(false);
    expect(hasHardFailure([softOnly])).toBe(false); // solo blando
    expect(hasHardFailure([hardFail])).toBe(true);
    expect(hasHardFailure([{ ...pass, uniqueCorrect: false }])).toBe(true);
    expect(hasHardFailure([{ ...pass, factual: false }])).toBe(true);
    expect(hasHardFailure([pass, hardFail])).toBe(true);
  });
});

describe('objectionsFrom', () => {
  it('agrega (dedup) objeciones de veredictos con falla dura e ignora los blandos', () => {
    // skillMatch blando no aporta objeciones (no gatilla regeneración).
    expect(objectionsFrom([softOnly])).toEqual([]);
    // dedup entre veredictos duros.
    expect(
      objectionsFrom([hardFail, { ...hardFail, objections: ['obj-answerable', 'otra'] }]),
    ).toEqual(['obj-answerable', 'otra']);
  });
});
