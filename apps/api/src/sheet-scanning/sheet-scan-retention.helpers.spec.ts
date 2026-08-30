import { files, type Database } from '@soe/db';
import {
  DEFAULT_OMR_RETENTION_DAYS,
  formatOrgRetentionReport,
  purgeExpiredSheetScanFiles,
  resolveRetentionDays,
  retentionCutoff,
} from './sheet-scan-retention.helpers';

const NOW = new Date('2026-08-30T12:00:00Z');
const ORG = { id: 'org-1', name: 'Colegio Demo', config: {} };

type RecordedUpdate = { table: unknown; set: Record<string, unknown> };

function makeDb(selectResults: unknown[][]): { db: Database; updates: RecordedUpdate[] } {
  let selectIdx = 0;
  const updates: RecordedUpdate[] = [];

  const db = {
    select: () => {
      const rows = selectResults[selectIdx++] ?? [];
      const chain = {
        from: () => chain,
        where: () => Promise.resolve(rows),
      };
      return chain;
    },
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ table, set });
        return { where: () => Promise.resolve([]) };
      },
    }),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  } as unknown as Database;

  return { db, updates };
}

function makeStorage(): { storage: { deleteObject: jest.Mock }; deletedKeys: string[] } {
  const deletedKeys: string[] = [];
  const deleteObject = jest.fn().mockImplementation(async (key: string) => {
    deletedKeys.push(key);
  });
  return { storage: { deleteObject }, deletedKeys };
}

const EXPIRED_ROWS = [
  { id: 'f-1', storageKey: 'sheet_scan/org-1/s1/a.jpg', purpose: 'scan_thumb' },
  { id: 'f-2', storageKey: 'sheet_scan_mark/org-1/m1/b.jpg', purpose: 'mark_crop' },
  { id: 'f-3', storageKey: 'sheet_scan/org-1/s2/c.pdf', purpose: 'scan_source' },
];

describe('resolveRetentionDays', () => {
  it('usa omrRetentionDays de la config de la org cuando está definido', () => {
    expect(resolveRetentionDays({ omrRetentionDays: 30 })).toBe(30);
  });

  it('cae al default 180 con config vacía, null o inválida', () => {
    expect(resolveRetentionDays({})).toBe(DEFAULT_OMR_RETENTION_DAYS);
    expect(resolveRetentionDays(null)).toBe(DEFAULT_OMR_RETENTION_DAYS);
    expect(resolveRetentionDays({ omrRetentionDays: -5 })).toBe(DEFAULT_OMR_RETENTION_DAYS);
  });
});

describe('retentionCutoff', () => {
  it('resta exactamente los días de retención', () => {
    expect(retentionCutoff(180, NOW)).toEqual(new Date('2026-03-03T12:00:00Z'));
  });
});

describe('purgeExpiredSheetScanFiles', () => {
  it('en dry-run reporta lo expirado sin borrar de S3 ni soft-deletear', async () => {
    const { db, updates } = makeDb([EXPIRED_ROWS]);
    const { storage } = makeStorage();

    const report = await purgeExpiredSheetScanFiles({ db, storage, org: ORG, dryRun: true, now: NOW });

    expect(report.expiredCount).toBe(3);
    expect(report.byPurpose).toEqual({ scan_thumb: 1, mark_crop: 1, scan_source: 1 });
    expect(report.deletedFromS3).toBe(0);
    expect(report.softDeleted).toBe(0);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('borra cada objeto de S3 y soft-deletea las filas expiradas de files', async () => {
    const { db, updates } = makeDb([EXPIRED_ROWS]);
    const { storage, deletedKeys } = makeStorage();

    const report = await purgeExpiredSheetScanFiles({ db, storage, org: ORG, dryRun: false, now: NOW });

    expect(report.deletedFromS3).toBe(3);
    expect(report.softDeleted).toBe(3);
    expect(deletedKeys).toEqual(EXPIRED_ROWS.map((row) => row.storageKey));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(files);
    expect(updates[0]?.set).toMatchObject({ deletedAt: NOW });
  });

  it('sin archivos expirados no toca S3 ni la base', async () => {
    const { db, updates } = makeDb([[]]);
    const { storage } = makeStorage();

    const report = await purgeExpiredSheetScanFiles({ db, storage, org: ORG, dryRun: false, now: NOW });

    expect(report.expiredCount).toBe(0);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('las escrituras van SOLO a files: jamás toca sheet_scan_marks ni resultados', async () => {
    const { db, updates } = makeDb([EXPIRED_ROWS]);
    const { storage } = makeStorage();

    await purgeExpiredSheetScanFiles({ db, storage, org: ORG, dryRun: false, now: NOW });

    expect(updates.every((update) => update.table === files)).toBe(true);
  });
});

describe('formatOrgRetentionReport', () => {
  it('distingue el resumen de dry-run del de ejecución real', () => {
    const base = {
      orgId: 'org-1',
      orgName: 'Colegio Demo',
      retentionDays: 180,
      cutoff: new Date('2026-03-03T12:00:00Z'),
      expiredCount: 2,
      byPurpose: { scan_thumb: 2 },
      deletedFromS3: 2,
      softDeleted: 2,
    };
    expect(formatOrgRetentionReport({ ...base, dryRun: true })).toContain('DRY-RUN');
    expect(formatOrgRetentionReport({ ...base, dryRun: false })).toContain('Borradas de S3: 2');
  });
});
