/**
 * Retención de imágenes del lector de marcas (E22, CD-14 / D18).
 *
 * Borra de S3 y soft-deletea en `files` las imágenes del lector
 * (`owner_type IN ('sheet_scan', 'sheet_scan_mark')`: fuentes de lote, thumbnails
 * y recortes de evidencia) más viejas que la retención configurada por cada org
 * (`organizations.config.omrRetentionDays`, default 180 días).
 *
 * JAMÁS toca `sheet_scan_marks` ni resultados: el dato corregido es permanente,
 * sólo caduca la evidencia visual (Ley 19.628 — las hojas llevan nombre de alumno).
 *
 * Uso (pensado para cron externo diario):
 *   DATABASE_ADMIN_URL="postgresql://soe_admin:<pw>@<host>:5432/soe" \
 *   STORAGE_S3_BUCKET=<bucket> AWS_REGION=us-east-1 \
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... [AWS_SESSION_TOKEN=...] \
 *     pnpm --filter @soe/api retention:sheet-scans
 *
 * Con `--dry-run` sólo reporta qué borraría, por org, sin tocar nada.
 */
import 'reflect-metadata';
import { isNull } from 'drizzle-orm';
import { createDbClient, organizations } from '@soe/db';
import { StorageService } from '../src/storage/storage.service';
import {
  formatOrgRetentionReport,
  purgeExpiredSheetScanFiles,
} from '../src/sheet-scanning/sheet-scan-retention.helpers';

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error('Falta DATABASE_ADMIN_URL');

  const storage = new StorageService();
  await storage.onModuleInit();
  if (!dryRun && !storage.isConfigured()) {
    throw new Error('Storage S3 sin configurar: define STORAGE_S3_BUCKET y las credenciales AWS');
  }

  const db = createDbClient(connectionString);

  const orgs = await db
    .select({ id: organizations.id, name: organizations.name, config: organizations.config })
    .from(organizations)
    .where(isNull(organizations.deletedAt));

  console.log(
    `Retención de imágenes del lector · ${orgs.length} orgs${dryRun ? ' · DRY-RUN' : ''}\n`,
  );

  let totalExpired = 0;
  let totalDeleted = 0;
  for (const org of orgs) {
    const report = await purgeExpiredSheetScanFiles({ db, storage, org, dryRun });
    totalExpired += report.expiredCount;
    totalDeleted += report.softDeleted;
    console.log(formatOrgRetentionReport(report));
  }

  console.log(
    dryRun
      ? `\nDRY-RUN: ${totalExpired} imágenes expiradas en total. Quita --dry-run para borrar.`
      : `\n✅ ${totalDeleted} imágenes borradas (S3 + soft-delete en files).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
