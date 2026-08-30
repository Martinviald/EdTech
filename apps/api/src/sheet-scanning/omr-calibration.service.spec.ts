import { NotFoundException } from '@nestjs/common';
import type { Database } from '@soe/db';
import { OmrCalibrationService } from './omr-calibration.service';

const ORG_ID = '22222222-2222-4222-8222-222222222222';

type QueryChain = {
  from: (..._: unknown[]) => QueryChain;
  where: (..._: unknown[]) => QueryChain;
  then: <T>(resolve: (rows: unknown[]) => T, reject?: (err: unknown) => unknown) => Promise<T>;
};

type RecordedUpdate = { set: Record<string, unknown> };

function makeDb(selectResults: unknown[][]): { db: Database; updates: RecordedUpdate[] } {
  let selectIdx = 0;
  const updates: RecordedUpdate[] = [];

  function chain(rows: unknown[]): QueryChain {
    const c: QueryChain = {
      from: () => c,
      where: () => c,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) as never,
    };
    return c;
  }

  const db = {
    select: () => chain(selectResults[selectIdx++] ?? []),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ set });
        return { where: () => Promise.resolve([]) };
      },
    }),
  } as unknown as Database;

  return { db, updates };
}

describe('OmrCalibrationService.getCalibration', () => {
  it('org sin calibración configurada devuelve el objeto vacío (defaults del clasificador)', async () => {
    const { db } = makeDb([[{ id: ORG_ID, config: { allowedFeatures: ['remedial'] } }]]);
    const service = new OmrCalibrationService(db);

    const result = await service.getCalibration(ORG_ID);

    expect(result).toEqual({ orgId: ORG_ID, calibration: {} });
  });

  it('devuelve la calibración guardada en organizations.config.omrCalibration', async () => {
    const { db } = makeDb([
      [{ id: ORG_ID, config: { omrCalibration: { ambiguityMargin: 0.15, minSeparability: 0.4 } } }],
    ]);
    const service = new OmrCalibrationService(db);

    const result = await service.getCalibration(ORG_ID);

    expect(result.calibration).toEqual({ ambiguityMargin: 0.15, minSeparability: 0.4 });
  });

  it('org inexistente lanza NotFound', async () => {
    const { db } = makeDb([[]]);
    const service = new OmrCalibrationService(db);

    await expect(service.getCalibration(ORG_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OmrCalibrationService.updateCalibration', () => {
  it('reemplaza omrCalibration con merge no destructivo del resto del config', async () => {
    const currentConfig = {
      allowedFeatures: ['remedial'],
      branding: { logoFileId: null },
      omrCalibration: { ambiguityMargin: 0.25 },
    };
    const { db, updates } = makeDb([
      [{ config: currentConfig }],
      [{ id: ORG_ID, config: { ...currentConfig, omrCalibration: { ambiguityMargin: 0.1 } } }],
    ]);
    const service = new OmrCalibrationService(db);

    const result = await service.updateCalibration(ORG_ID, { ambiguityMargin: 0.1 });

    expect(updates).toHaveLength(1);
    expect(updates[0].set.config).toEqual({
      allowedFeatures: ['remedial'],
      branding: { logoFileId: null },
      omrCalibration: { ambiguityMargin: 0.1 },
    });
    expect(result.calibration).toEqual({ ambiguityMargin: 0.1 });
  });

  it('org inexistente lanza NotFound sin escribir', async () => {
    const { db, updates } = makeDb([[]]);
    const service = new OmrCalibrationService(db);

    await expect(
      service.updateCalibration(ORG_ID, { ambiguityMargin: 0.1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updates).toHaveLength(0);
  });
});
