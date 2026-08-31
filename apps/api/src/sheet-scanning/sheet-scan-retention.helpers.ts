import { and, inArray, isNull, lt, eq } from 'drizzle-orm';
import { files, withOrgContext, type Database } from '@soe/db';
import { orgConfigSchema } from '@soe/types';

export const SHEET_SCAN_FILE_OWNER_TYPES = ['sheet_scan', 'sheet_scan_mark'] as const;
export const DEFAULT_OMR_RETENTION_DAYS = 180;
const SOFT_DELETE_CHUNK_SIZE = 100;

export type RetentionOrg = {
  id: string;
  name: string;
  config: unknown;
};

export type RetentionStorage = {
  deleteObject(key: string): Promise<void>;
};

export type OrgRetentionReport = {
  orgId: string;
  orgName: string;
  retentionDays: number;
  cutoff: Date;
  expiredCount: number;
  byPurpose: Record<string, number>;
  deletedFromS3: number;
  softDeleted: number;
  dryRun: boolean;
};

export function resolveRetentionDays(config: unknown): number {
  const parsed = orgConfigSchema.safeParse(config ?? {});
  if (!parsed.success) return DEFAULT_OMR_RETENTION_DAYS;
  return parsed.data.omrRetentionDays ?? DEFAULT_OMR_RETENTION_DAYS;
}

export function retentionCutoff(retentionDays: number, now: Date): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function purgeExpiredSheetScanFiles(params: {
  db: Database;
  storage: RetentionStorage;
  org: RetentionOrg;
  dryRun: boolean;
  now?: Date;
}): Promise<OrgRetentionReport> {
  const { db, storage, org, dryRun } = params;
  const now = params.now ?? new Date();
  const retentionDays = resolveRetentionDays(org.config);
  const cutoff = retentionCutoff(retentionDays, now);

  const expired = await withOrgContext(db, org.id, (tx) =>
    tx
      .select({ id: files.id, storageKey: files.storageKey, purpose: files.purpose })
      .from(files)
      .where(
        and(
          eq(files.orgId, org.id),
          inArray(files.ownerType, [...SHEET_SCAN_FILE_OWNER_TYPES]),
          isNull(files.deletedAt),
          lt(files.createdAt, cutoff),
        ),
      ),
  );

  const byPurpose: Record<string, number> = {};
  for (const row of expired) {
    const purpose = row.purpose ?? 'sin_purpose';
    byPurpose[purpose] = (byPurpose[purpose] ?? 0) + 1;
  }

  const report: OrgRetentionReport = {
    orgId: org.id,
    orgName: org.name,
    retentionDays,
    cutoff,
    expiredCount: expired.length,
    byPurpose,
    deletedFromS3: 0,
    softDeleted: 0,
    dryRun,
  };

  if (dryRun || expired.length === 0) return report;

  for (const row of expired) {
    await storage.deleteObject(row.storageKey);
    report.deletedFromS3 += 1;
  }

  for (const ids of chunk(
    expired.map((row) => row.id),
    SOFT_DELETE_CHUNK_SIZE,
  )) {
    await withOrgContext(db, org.id, (tx) =>
      tx
        .update(files)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(files.orgId, org.id), inArray(files.id, ids))),
    );
    report.softDeleted += ids.length;
  }

  return report;
}

export function formatOrgRetentionReport(report: OrgRetentionReport): string {
  const purposes = Object.entries(report.byPurpose)
    .map(([purpose, count]) => `${purpose}=${count}`)
    .join(', ');
  const header =
    `${report.orgName} (${report.orgId}) · retención ${report.retentionDays} días · ` +
    `corte ${report.cutoff.toISOString()} · ${report.expiredCount} imágenes expiradas` +
    (purposes ? ` [${purposes}]` : '');
  if (report.dryRun) return `${header}\n  DRY-RUN: no se borró nada.`;
  return `${header}\n  Borradas de S3: ${report.deletedFromS3} · soft-delete en files: ${report.softDeleted}`;
}
