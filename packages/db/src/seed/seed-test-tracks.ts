/**
 * Seed idempotente del catálogo OFICIAL de líneas de prueba (test_tracks con org_id NULL).
 * Reference-data, replicable en prod:
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:seed:test-tracks [--dry-run]
 *
 * Fuente: packages/db/data/test-tracks.json (validado con testTrackCatalogSchema).
 * La asignatura se resuelve por `subjects.code`; si falta alguna, aborta sin escribir.
 * Upsert por (subject_id, code) entre las oficiales: inserta las nuevas, actualiza
 * nombre/orden de las que cambiaron y no toca las iguales. Nunca borra: una línea que
 * sale del JSON puede tener instrumentos colgando (FK), así que se retira a mano.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync } from 'node:fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { testTrackCatalogSchema, type TestTrackCatalogEntryInput } from '@soe/types';
import { createDbClient, type Database } from '../client';
import { assertAdminConnection } from '../lib/assert-admin-connection';
import { subjects } from '../schema/academic';
import { testTracks } from '../schema/test-tracks';

export const TEST_TRACKS_CATALOG_PATH = resolve(__dirname, '../../data/test-tracks.json');

export type SeedTestTracksSummary = {
  inserted: string[];
  updated: string[];
  unchanged: string[];
};

export function loadTestTrackCatalog(
  path = TEST_TRACKS_CATALOG_PATH,
): TestTrackCatalogEntryInput[] {
  const parsed = testTrackCatalogSchema.safeParse(JSON.parse(readFileSync(path, 'utf-8')));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Catálogo de líneas inválido (${path}): ${detail}`);
  }
  return parsed.data.tracks;
}

export async function seedTestTracks(
  db: Database,
  options: { dryRun?: boolean; catalogPath?: string } = {},
): Promise<SeedTestTracksSummary> {
  const catalog = loadTestTrackCatalog(options.catalogPath);
  const subjectRows = await db.select({ id: subjects.id, code: subjects.code }).from(subjects);
  const subjectIdByCode = new Map(subjectRows.map((s) => [s.code, s.id]));
  const missing = [...new Set(catalog.map((t) => t.subjectCode))].filter(
    (code) => !subjectIdByCode.has(code),
  );
  if (missing.length > 0) {
    throw new Error(`Asignaturas inexistentes en subjects.code: ${missing.join(', ')}`);
  }

  const summary: SeedTestTracksSummary = { inserted: [], updated: [], unchanged: [] };
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: testTracks.id,
        subjectId: testTracks.subjectId,
        code: testTracks.code,
        name: testTracks.name,
        shortName: testTracks.shortName,
        order: testTracks.order,
      })
      .from(testTracks)
      .where(isNull(testTracks.orgId));
    const existingByKey = new Map(existing.map((row) => [`${row.subjectId}|${row.code}`, row]));

    for (const track of catalog) {
      const subjectId = subjectIdByCode.get(track.subjectCode)!;
      const label = `${track.subjectCode}/${track.code}`;
      const current = existingByKey.get(`${subjectId}|${track.code}`);
      if (!current) {
        summary.inserted.push(label);
        if (!options.dryRun) {
          await tx.insert(testTracks).values({
            orgId: null,
            subjectId,
            code: track.code,
            name: track.name,
            shortName: track.shortName,
            order: track.order,
          });
        }
        continue;
      }
      const same =
        current.name === track.name &&
        current.shortName === track.shortName &&
        current.order === track.order;
      if (same) {
        summary.unchanged.push(label);
        continue;
      }
      summary.updated.push(label);
      if (!options.dryRun) {
        await tx
          .update(testTracks)
          .set({
            name: track.name,
            shortName: track.shortName,
            order: track.order,
            updatedAt: sql`now()`,
          })
          .where(and(eq(testTracks.id, current.id), isNull(testTracks.orgId)));
      }
    }
  });
  return summary;
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const dryRun = !process.argv.includes('--commit');
  const db = createDbClient(url);
  assertAdminConnection(db, 'db:seed:test-tracks')
    .then(() => seedTestTracks(db, { dryRun }))
    .then((summary) => {
      const mode = dryRun ? ' (dry-run, sin escribir)' : '';
      console.log(`Líneas de prueba oficiales${mode}:`);
      console.log(`  insertadas:   ${summary.inserted.length} ${summary.inserted.join(' ')}`);
      console.log(`  actualizadas: ${summary.updated.length} ${summary.updated.join(' ')}`);
      console.log(`  sin cambios:  ${summary.unchanged.length}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error('ERROR seed test tracks:', e);
      process.exit(1);
    });
}
