import { DECISION_FEATURE_DEFAULTS } from '@soe/types';
import type { Database } from '../database/database.types';
import { DecisionsConfigService } from './decisions-config.service';

const ORG_ID = '00000000-0000-0000-0000-0000000000aa';

interface SettingRow {
  orgId: string | null;
  engine: 'jev';
  model: string;
  mode: 'off' | 'shadow' | 'live';
  thresholds: unknown;
}

function makeDb(rows: SettingRow[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: jest.fn(() => Promise.resolve(rows)),
  };
  const tx = { execute: jest.fn(() => Promise.resolve()), select: jest.fn(() => chain) };
  const db = {
    transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as Database & { transaction: jest.Mock };
  return { db, tx };
}

describe('DecisionsConfigService', () => {
  it('sin filas usa el default de código', async () => {
    const { db } = makeDb([]);

    const cfg = await new DecisionsConfigService(db).resolve(ORG_ID, 'remedial_judge');

    expect(cfg).toEqual({ ...DECISION_FEATURE_DEFAULTS.remedial_judge, source: 'default' });
  });

  it('marca el origen global u org según la fila encontrada', async () => {
    const base = {
      engine: 'jev' as const,
      model: 'jev-1.13.0',
      mode: 'shadow' as const,
      thresholds: {},
    };

    const global = await new DecisionsConfigService(makeDb([{ ...base, orgId: null }]).db).resolve(
      ORG_ID,
      'remedial_judge',
    );
    const org = await new DecisionsConfigService(makeDb([{ ...base, orgId: ORG_ID }]).db).resolve(
      ORG_ID,
      'remedial_judge',
    );

    expect(global.source).toBe('global');
    expect(org.source).toBe('org');
  });

  it('con umbrales inválidos cae al default de código', async () => {
    const { db } = makeDb([
      {
        orgId: null,
        engine: 'jev',
        model: 'jev-1.13.0',
        mode: 'live',
        thresholds: { clave: { auto: 0.5, review: 0.7 } },
      },
    ]);

    const cfg = await new DecisionsConfigService(db).resolve(ORG_ID, 'remedial_judge');

    expect(cfg.mode).toBe('live');
    expect(cfg.thresholds).toEqual(DECISION_FEATURE_DEFAULTS.remedial_judge.thresholds);
  });

  it('comparte una sola consulta entre llamadas concurrentes y dentro del TTL', async () => {
    const { db } = makeDb([]);
    const service = new DecisionsConfigService(db);

    await Promise.all(Array.from({ length: 10 }, () => service.resolve(ORG_ID, 'remedial_judge')));
    await service.resolve(ORG_ID, 'remedial_judge');

    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('no cachea una lectura fallida', async () => {
    const { db } = makeDb([]);
    db.transaction.mockRejectedValueOnce(new Error('bd caída'));
    const service = new DecisionsConfigService(db);

    await expect(service.resolve(ORG_ID, 'remedial_judge')).rejects.toThrow('bd caída');
    await expect(service.resolve(ORG_ID, 'remedial_judge')).resolves.toMatchObject({
      source: 'default',
    });
  });
});
