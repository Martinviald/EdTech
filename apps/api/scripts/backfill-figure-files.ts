/**
 * Backfill del INVENTARIO (`files`) de las figuras que ya están en S3.
 *
 * Las figuras de los instrumentos oficiales las sube el pipeline de extracción de PDFs,
 * fuera de la app: recorta los PNG, los sube al bucket y deja la storage key en el dato
 * de dominio (`items.scoring_config.imageRef` / `altImageRefs`,
 * `section_attachments.storage_key`). Lo que ese pipeline NO hace es registrar el objeto
 * en `files`. En la carga 2025 lo cerró un script aparte; en la 2026 nadie lo corrió y
 * quedaron ~400 objetos en S3 sin fila.
 *
 * Desde que la figura se sirve desde la storage key, esa brecha ya no rompe la vista.
 * Sigue importando porque `files` es el inventario: es lo que usa `removeByOwner` para
 * borrar el objeto en S3 al eliminar su dueño. Sin fila, borrar deja huérfanos.
 *
 * Es IDEMPOTENTE por `storage_key` y verifica cada objeto con `headObject` antes de
 * registrarlo: una key que no existe en el bucket se reporta, no se inventa una fila.
 * Correrlo después de cada carga de instrumentos.
 *
 * Uso (DRY-RUN por defecto: no escribe, sólo reporta):
 *   DATABASE_ADMIN_URL="postgresql://soe_admin:<pw>@<host>:5432/soe" \
 *   STORAGE_S3_BUCKET=<bucket> AWS_REGION=us-east-1 \
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... [AWS_SESSION_TOKEN=...] \
 *     pnpm --filter @soe/api exec tsx scripts/backfill-figure-files.ts
 *
 * Para persistir, agregar `--confirm`.
 */
import 'reflect-metadata';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  createDbClient,
  files,
  instrumentSections,
  instruments,
  items,
  sectionAttachments,
  type Database,
} from '@soe/db';
import { StorageService } from '../src/storage/storage.service';
import { FIGURE_SCOPES, type FigureScope } from '../src/files/figure-scopes';

type PendingFigure = {
  scope: FigureScope;
  storageKey: string;
  ownerId: string;
  orgId: string | null;
  slug: string | null;
  position: number | null;
};

const confirm = process.argv.includes('--confirm');

function slugOf(storageKey: string): string | null {
  return storageKey.split('/')[2] ?? null;
}

async function collectItemFigures(db: Database): Promise<PendingFigure[]> {
  const rows = await db
    .select({
      id: items.id,
      orgId: items.orgId,
      position: items.position,
      scoringConfig: items.scoringConfig,
    })
    .from(items)
    .where(isNull(items.deletedAt));

  const pending: PendingFigure[] = [];
  for (const row of rows) {
    const imageRef = row.scoringConfig?.imageRef;
    if (typeof imageRef === 'string' && imageRef.length > 0) {
      pending.push({
        scope: 'item',
        storageKey: imageRef,
        ownerId: row.id,
        orgId: row.orgId,
        slug: slugOf(imageRef),
        position: row.position,
      });
    }

    const altRefs = row.scoringConfig?.altImageRefs as Record<string, unknown> | undefined;
    for (const key of Object.keys(altRefs ?? {})) {
      const ref = altRefs?.[key];
      if (typeof ref !== 'string' || ref.length === 0) continue;
      pending.push({
        scope: 'alternative',
        storageKey: ref,
        ownerId: row.id,
        orgId: row.orgId,
        slug: slugOf(ref),
        position: row.position,
      });
    }
  }
  return pending;
}

async function collectSectionFigures(db: Database): Promise<PendingFigure[]> {
  const rows = await db
    .select({
      sectionId: sectionAttachments.sectionId,
      storageKey: sectionAttachments.storageKey,
      orgId: instruments.orgId,
      order: sectionAttachments.order,
    })
    .from(sectionAttachments)
    .innerJoin(instrumentSections, eq(instrumentSections.id, sectionAttachments.sectionId))
    .innerJoin(instruments, eq(instruments.id, instrumentSections.instrumentId))
    .where(and(eq(sectionAttachments.kind, 'image'), isNotNull(sectionAttachments.storageKey)));

  return rows
    .filter((row): row is typeof row & { storageKey: string } => row.storageKey !== null)
    .map((row) => ({
      scope: 'section' as const,
      storageKey: row.storageKey,
      ownerId: row.sectionId,
      orgId: row.orgId,
      slug: slugOf(row.storageKey),
      position: row.order,
    }));
}

async function loadRegisteredKeys(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({ storageKey: files.storageKey })
    .from(files)
    .where(isNull(files.deletedAt));
  return new Set(rows.map((r) => r.storageKey));
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error('Falta DATABASE_ADMIN_URL');

  const storage = new StorageService();
  await storage.onModuleInit();
  if (!storage.isConfigured()) {
    throw new Error('Storage S3 sin configurar: define STORAGE_S3_BUCKET y las credenciales AWS');
  }

  const db = createDbClient(connectionString);

  const [itemFigures, sectionFigures, registered] = await Promise.all([
    collectItemFigures(db),
    collectSectionFigures(db),
    loadRegisteredKeys(db),
  ]);

  const declared = [...itemFigures, ...sectionFigures];
  const missing = declared.filter((f) => !registered.has(f.storageKey));

  console.log(
    `Declaradas ${declared.length} figuras · ${registered.size} keys ya registradas en files · ${missing.length} sin fila`,
  );
  if (missing.length === 0) return;

  const orphanKeys: string[] = [];
  const toInsert: (typeof files.$inferInsert)[] = [];

  for (const figure of missing) {
    const head = await storage.headObject(figure.storageKey);
    if (!head.exists) {
      orphanKeys.push(figure.storageKey);
      continue;
    }
    const scope = FIGURE_SCOPES[figure.scope];
    const baseName = figure.storageKey.split('/').pop() ?? figure.storageKey;

    toInsert.push({
      orgId: figure.orgId,
      status: 'ready',
      storageKey: figure.storageKey,
      fileName: figure.slug ? `${figure.slug}__${baseName}` : baseName,
      mimeType: head.contentType ?? 'image/png',
      sizeBytes: head.sizeBytes,
      ownerType: scope.ownerType,
      ownerId: figure.ownerId,
      purpose: scope.purpose,
      meta: { slug: figure.slug, position: figure.position },
    });
  }

  const byPurpose = new Map<string, number>();
  for (const row of toInsert) {
    byPurpose.set(row.purpose ?? '?', (byPurpose.get(row.purpose ?? '?') ?? 0) + 1);
  }
  for (const [purpose, count] of byPurpose) console.log(`  ${purpose}: ${count}`);

  if (orphanKeys.length > 0) {
    console.warn(`⚠️  ${orphanKeys.length} keys declaradas SIN objeto en S3 (no se registran):`);
    for (const key of orphanKeys) console.warn(`     ${key}`);
  }

  if (!confirm) {
    console.log(`\nDRY-RUN: se insertarían ${toInsert.length} filas. Agrega --confirm.`);
    return;
  }

  for (let i = 0; i < toInsert.length; i += 100) {
    await db.insert(files).values(toInsert.slice(i, i + 100));
  }
  console.log(`\n✅ ${toInsert.length} filas insertadas en files.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
