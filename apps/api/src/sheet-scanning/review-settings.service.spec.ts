import { NotFoundException } from '@nestjs/common';
import type { Database } from '@soe/db';
import { ReviewSettingsService } from './review-settings.service';

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

describe('ReviewSettingsService.getSettings', () => {
  it('org sin review configurado devuelve el objeto vacío (ambos ajustes apagados)', async () => {
    const { db } = makeDb([[{ id: ORG_ID, config: { allowedFeatures: ['remedial'] } }]]);
    const service = new ReviewSettingsService(db);

    const result = await service.getSettings(ORG_ID);

    expect(result).toEqual({ orgId: ORG_ID, review: {} });
  });

  it('devuelve los ajustes guardados en organizations.config.review', async () => {
    const { db } = makeDb([
      [{ id: ORG_ID, config: { review: { quickConfirm: true, autoAnnulMinConfidence: 0.9 } } }],
    ]);
    const service = new ReviewSettingsService(db);

    const result = await service.getSettings(ORG_ID);

    expect(result.review).toEqual({ quickConfirm: true, autoAnnulMinConfidence: 0.9 });
  });

  it('org inexistente lanza NotFound', async () => {
    const { db } = makeDb([[]]);
    const service = new ReviewSettingsService(db);

    await expect(service.getSettings(ORG_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReviewSettingsService.updateSettings', () => {
  it('enciende ambos ajustes preservando el resto del config', async () => {
    const currentConfig = {
      allowedFeatures: ['remedial'],
      omrCalibration: { ambiguityMargin: 0.25 },
    };
    const { db, updates } = makeDb([
      [{ config: currentConfig }],
      [
        {
          id: ORG_ID,
          config: {
            ...currentConfig,
            review: { quickConfirm: true, autoAnnulMinConfidence: 0.9 },
          },
        },
      ],
    ]);
    const service = new ReviewSettingsService(db);

    const result = await service.updateSettings(ORG_ID, {
      quickConfirm: true,
      autoAnnulMinConfidence: 0.9,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].set.config).toEqual({
      allowedFeatures: ['remedial'],
      omrCalibration: { ambiguityMargin: 0.25 },
      review: { quickConfirm: true, autoAnnulMinConfidence: 0.9 },
    });
    expect(result.review).toEqual({ quickConfirm: true, autoAnnulMinConfidence: 0.9 });
  });

  it('PATCH parcial: mandar sólo quickConfirm no toca el umbral', async () => {
    const currentConfig = { review: { quickConfirm: true, autoAnnulMinConfidence: 0.9 } };
    const { db, updates } = makeDb([
      [{ config: currentConfig }],
      [{ id: ORG_ID, config: { review: { quickConfirm: false, autoAnnulMinConfidence: 0.9 } } }],
    ]);
    const service = new ReviewSettingsService(db);

    await service.updateSettings(ORG_ID, { quickConfirm: false });

    expect(updates[0].set.config).toEqual({
      review: { quickConfirm: false, autoAnnulMinConfidence: 0.9 },
    });
  });

  it('autoAnnulMinConfidence null apaga la nula automática eliminando la clave', async () => {
    const currentConfig = {
      branding: { logoFileId: null },
      review: { quickConfirm: true, autoAnnulMinConfidence: 0.9 },
    };
    const { db, updates } = makeDb([
      [{ config: currentConfig }],
      [{ id: ORG_ID, config: { ...currentConfig, review: { quickConfirm: true } } }],
    ]);
    const service = new ReviewSettingsService(db);

    const result = await service.updateSettings(ORG_ID, { autoAnnulMinConfidence: null });

    expect(updates[0].set.config).toEqual({
      branding: { logoFileId: null },
      review: { quickConfirm: true },
    });
    expect(Object.keys((updates[0].set.config as { review: object }).review)).toEqual([
      'quickConfirm',
    ]);
    expect(result.review).toEqual({ quickConfirm: true });
  });

  it('org inexistente lanza NotFound sin escribir', async () => {
    const { db, updates } = makeDb([[]]);
    const service = new ReviewSettingsService(db);

    await expect(
      service.updateSettings(ORG_ID, { quickConfirm: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updates).toHaveLength(0);
  });
});
