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
 * `--set <instrumentId>=<CODE>` (repetible) asigna la línea a un instrumento que no tiene JSON
 * en el repo (p. ej. DIA Speaking en demo), con las mismas validaciones: la línea tiene que
 * ser de la asignatura del instrumento y un instrumento oficial solo usa líneas oficiales.
 * Si el JSON del instrumento declara otra línea, es un error.
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
import {
  indexTestTracksByCode,
  resolveTestTrack,
  type TestTrackOwner,
  type TestTrackRef,
} from '@soe/types';
import { createDbClient, type Database } from '../client';
import { instruments } from '../schema/instruments';
import { testTracks } from '../schema/test-tracks';
import { instrumentSourceJson, type InstrumentSourceDoc } from '../lib/instrument-source';

const DATA_ROOT = resolve(__dirname, '../../data');

type DeclaredTrack = { file: string; sourceJson: string; code: string | null };

export type ExplicitTrackAssignment = { instrumentId: string; code: string };

export type TrackTarget = TestTrackOwner & { id: string; trackId: string | null };

export type TrackAssignmentPlan = {
  assigned: string[];
  alreadySet: string[];
  errors: string[];
  updates: { instrumentId: string; trackId: string }[];
};

export type TrackBackfillReport = {
  assigned: string[];
  alreadySet: string[];
  notLoaded: string[];
  keptWithoutDeclaration: string[];
  errors: string[];
};

export function parseTrackArgs(argv: readonly string[]): {
  commit: boolean;
  dirs: string[];
  explicit: ExplicitTrackAssignment[];
} {
  const dirs: string[] = [];
  const explicit: ExplicitTrackAssignment[] = [];
  argv.forEach((arg, index) => {
    const value = argv[index + 1];
    if (arg === '--dir' && value) dirs.push(resolve(value));
    if (arg !== '--set') return;
    const match = /^([^=\s]+)=([^=\s]+)$/.exec(value ?? '');
    if (!match) {
      throw new Error(`--set espera <instrumentId>=<CODE>; recibió "${value ?? ''}".`);
    }
    explicit.push({ instrumentId: match[1]!, code: match[2]! });
  });
  return { commit: argv.includes('--commit'), dirs, explicit };
}

export function planTrackAssignments(
  targets: readonly { target: TrackTarget; code: string }[],
  tracksByCode: ReadonlyMap<string, readonly TestTrackRef[]>,
): TrackAssignmentPlan {
  const plan: TrackAssignmentPlan = { assigned: [], alreadySet: [], errors: [], updates: [] };
  const codeByInstrument = new Map<string, string>();
  for (const { target, code } of targets) {
    const previous = codeByInstrument.get(target.id);
    if (previous !== undefined) {
      if (previous !== code) {
        plan.errors.push(
          `${target.label}: se le piden dos líneas distintas ("${previous}" y "${code}").`,
        );
      }
      continue;
    }
    codeByInstrument.set(target.id, code);
    try {
      const track = resolveTestTrack(code, target, tracksByCode);
      if (target.trackId === track.id) {
        plan.alreadySet.push(`${target.label} → ${code}`);
      } else {
        plan.assigned.push(`${target.label} → ${code}`);
        plan.updates.push({ instrumentId: target.id, trackId: track.id });
      }
    } catch (e) {
      plan.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return plan;
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
    const doc = JSON.parse(readFileSync(file, 'utf-8')) as Partial<InstrumentSourceDoc>;
    if (!doc.instrument?.name) continue;
    declared.push({
      file,
      sourceJson: instrumentSourceJson(doc as InstrumentSourceDoc),
      code: doc.instrument.track ?? null,
    });
  }
  return declared;
}

export async function backfillInstrumentTracks(
  db: Database,
  options: { commit: boolean; dirs?: string[]; explicit?: ExplicitTrackAssignment[] },
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

  const toTarget = (row: (typeof loaded)[number]): TrackTarget => ({
    id: row.id,
    label: row.name,
    subjectId: row.subjectId,
    orgId: row.orgId,
    trackId: row.trackId,
  });
  const targets: { target: TrackTarget; code: string }[] = [];
  for (const { sourceJson, code } of declared) {
    const rows = loadedBySource.get(sourceJson) ?? [];
    if (rows.length === 0) {
      if (code) report.notLoaded.push(`${sourceJson} (${code})`);
      continue;
    }
    for (const row of rows) {
      if (code) targets.push({ target: toTarget(row), code });
      else if (row.trackId) report.keptWithoutDeclaration.push(row.name);
    }
  }
  const loadedById = new Map(loaded.map((row) => [row.id, row]));
  for (const { instrumentId, code } of options.explicit ?? []) {
    const row = loadedById.get(instrumentId);
    if (row) targets.push({ target: toTarget(row), code });
    else report.errors.push(`--set ${instrumentId}: el instrumento no existe o está borrado.`);
  }

  const plan = planTrackAssignments(targets, tracksByCode);
  report.assigned.push(...plan.assigned);
  report.alreadySet.push(...plan.alreadySet);
  report.errors.push(...plan.errors);
  const updates = plan.updates;

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
  const args = parseTrackArgs(process.argv.slice(2));
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
