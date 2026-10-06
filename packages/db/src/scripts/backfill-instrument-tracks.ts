/**
 * Backfill de `instruments.track_id` para instrumentos YA cargados, leyendo la línea que
 * declaran sus JSON versionados (`instrument.track`). Dry-run por defecto.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:backfill:tracks [--commit] [--dir <ruta>]…
 *
 * El JSON se cruza con la BDD por `instruments.config->>'sourceJson'`, la misma clave de
 * idempotencia del importador (`instrumentSourceJson`). Por defecto recorre todos los
 * `packages/db/data/instruments*`; `--dir` (repetible) reemplaza esa lista, por ejemplo para
 * incluir JSON que todavía viven fuera del repo.
 *
 * Idempotente: solo escribe donde el `track_id` actual difiere del declarado. Nunca limpia
 * una línea: si la BDD tiene una que el JSON no declara, lo reporta y no la toca. Las líneas
 * de sección (electivas) no se rellenan acá: esas secciones se crean con el importador.
 * Si alguna línea no se puede resolver (código inexistente, otra asignatura, privada en un
 * instrumento oficial), no escribe nada.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { indexTestTracksByCode, resolveTestTrack } from '@soe/types';
import { createDbClient, type Database } from '../client';
import { instruments } from '../schema/instruments';
import { testTracks } from '../schema/test-tracks';
import { instrumentSourceJson, type InstrumentJson } from '../seed/import-instruments';

const DATA_ROOT = resolve(__dirname, '../../data');

type DeclaredTrack = { file: string; sourceJson: string; code: string | null };

export type TrackBackfillReport = {
  assigned: string[];
  alreadySet: string[];
  notLoaded: string[];
  keptWithoutDeclaration: string[];
  errors: string[];
};

function parseArgs(argv: readonly string[]): { commit: boolean; dirs: string[] } {
  const dirs: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === '--dir' && argv[index + 1]) dirs.push(resolve(argv[index + 1]!));
  });
  return { commit: argv.includes('--commit'), dirs };
}

function defaultDirs(): string[] {
  return readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('instruments'))
    .map((entry) => resolve(DATA_ROOT, entry.name));
}

function listJsonFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) files.push(...listJsonFiles(path));
    else if (entry.endsWith('.json')) files.push(path);
  }
  return files;
}

function readDeclaredTracks(dirs: readonly string[]): DeclaredTrack[] {
  const declared: DeclaredTrack[] = [];
  for (const file of dirs.flatMap(listJsonFiles).sort()) {
    const doc = JSON.parse(readFileSync(file, 'utf-8')) as Partial<InstrumentJson>;
    if (!doc.instrument?.name) continue;
    declared.push({
      file,
      sourceJson: instrumentSourceJson(doc as InstrumentJson),
      code: doc.instrument.track ?? null,
    });
  }
  return declared;
}

export async function backfillInstrumentTracks(
  db: Database,
  options: { commit: boolean; dirs?: string[] },
): Promise<TrackBackfillReport> {
  const declared = readDeclaredTracks(options.dirs?.length ? options.dirs : defaultDirs());
  const report: TrackBackfillReport = {
    assigned: [],
    alreadySet: [],
    notLoaded: [],
    keptWithoutDeclaration: [],
    errors: [],
  };

  const tracksByCode = indexTestTracksByCode(
    await db
      .select({
        id: testTracks.id,
        orgId: testTracks.orgId,
        subjectId: testTracks.subjectId,
        code: testTracks.code,
      })
      .from(testTracks),
  );
  const loaded = await db
    .select({
      id: instruments.id,
      name: instruments.name,
      orgId: instruments.orgId,
      subjectId: instruments.subjectId,
      trackId: instruments.trackId,
      sourceJson: sql<string | null>`${instruments.config} ->> 'sourceJson'`,
    })
    .from(instruments)
    .where(isNull(instruments.deletedAt));
  const loadedBySource = new Map<string, typeof loaded>();
  for (const row of loaded) {
    if (!row.sourceJson) continue;
    const bucket = loadedBySource.get(row.sourceJson);
    if (bucket) bucket.push(row);
    else loadedBySource.set(row.sourceJson, [row]);
  }

  const updates: { instrumentId: string; trackId: string }[] = [];
  for (const { sourceJson, code } of declared) {
    const rows = loadedBySource.get(sourceJson) ?? [];
    if (rows.length === 0) {
      if (code) report.notLoaded.push(`${sourceJson} (${code})`);
      continue;
    }
    for (const row of rows) {
      if (!code) {
        if (row.trackId) report.keptWithoutDeclaration.push(row.name);
        continue;
      }
      try {
        const track = resolveTestTrack(
          code,
          { label: row.name, subjectId: row.subjectId, orgId: row.orgId },
          tracksByCode,
        );
        if (row.trackId === track.id) {
          report.alreadySet.push(`${row.name} → ${code}`);
        } else {
          report.assigned.push(`${row.name} → ${code}`);
          updates.push({ instrumentId: row.id, trackId: track.id });
        }
      } catch (e) {
        report.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (options.commit && report.errors.length === 0 && updates.length > 0) {
    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx
          .update(instruments)
          .set({ trackId: update.trackId, updatedAt: sql`now()` })
          .where(and(eq(instruments.id, update.instrumentId), isNull(instruments.deletedAt)));
      }
    });
  }
  return report;
}

function printReport(report: TrackBackfillReport, commit: boolean): void {
  const section = (title: string, lines: string[]) => {
    console.log(`${title}: ${lines.length}`);
    for (const line of lines) console.log(`  · ${line}`);
  };
  const verb = commit && report.errors.length === 0 ? 'asignadas' : 'por asignar (dry-run)';
  section(`Líneas ${verb}`, report.assigned);
  section('Ya asignadas', report.alreadySet);
  section('JSON con línea cuyo instrumento no está cargado', report.notLoaded);
  section(
    'Instrumentos con línea que su JSON no declara (no se tocan)',
    report.keptWithoutDeclaration,
  );
  section('Errores', report.errors);
  if (report.errors.length > 0) console.log('No se escribió nada: corrige los errores primero.');
  else if (!commit) console.log('Dry-run: re-corre con --commit para escribir.');
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const args = parseArgs(process.argv.slice(2));
  backfillInstrumentTracks(createDbClient(url), args)
    .then((report) => {
      printReport(report, args.commit);
      process.exit(report.errors.length > 0 ? 1 : 0);
    })
    .catch((e) => {
      console.error('ERROR backfill tracks:', e);
      process.exit(1);
    });
}
