/**
 * Gate del backfill de cohort-stats — decide, estampa y verifica.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:cohort-stamp check   [--force]
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:cohort-stamp write
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:cohort-stamp verify
 *
 * POR QUÉ EXISTE. El backfill completo cuesta ~10 de los ~11 minutos del job `migrate`
 * del deploy, y sólo hace falta cuando (a) cambió la semántica del recálculo o (b) hubo
 * una migración nueva. Correrlo en cada push es pagar 10 minutos por nada casi siempre;
 * NO correrlo sin una señal confiable es dejar la analítica con números viejos EN
 * SILENCIO, que es mucho peor. Este script es esa señal.
 *
 *  · `check`  — compara la huella del código (cierre de imports, ver
 *               lib/cohort-stats-fingerprint.ts) y la última migración aplicada contra
 *               lo estampado en `read_model_stamps`. Emite `run_backfill` por
 *               $GITHUB_OUTPUT. Ante CUALQUIER duda responde `true`: el lado seguro del
 *               error es repoblar de más.
 *  · `write`  — estampa. Se corre SÓLO si el backfill terminó con éxito; si falló, la
 *               fila queda con la huella vieja y el próximo deploy reintenta.
 *  · `verify` — smoke check (~1 s) que corre en TODO deploy, haya backfill o no. Falla
 *               el job si el read-model quedó en blanco. Es lo que reemplaza la garantía
 *               que antes daba correr el backfill siempre.
 *
 * Ver docs/plan-optimizar-backfill-cohort-stats.md §2.3 y §4 (Etapas D y E).
 */
import { config } from 'dotenv';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { and, eq, ne, sql } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { computeFingerprint, findRepoRoot } from '../lib/cohort-stats-fingerprint';
import { assessments } from '../schema/assessments';
import { assessmentItemStats, assessmentResults, readModelStamps } from '../schema/results';
import { organizations } from '../schema/organizations';
import { withOrgContext } from '../with-org-context';

/** Una sola fila: este read-model. Si mañana hay otro, es otro `id`. */
const STAMP_ID = 'cohort_stats';

type Command = 'check' | 'write' | 'verify';

function parseCommand(argv: readonly string[]): {
  command: Command;
  force: boolean;
  out?: string;
} {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const command = positional[0];
  if (command !== 'check' && command !== 'write' && command !== 'verify') {
    throw new Error(`Comando inválido: "${command ?? ''}". Se espera check | write | verify.`);
  }
  // `--out` deja la decisión en un archivo propio. El workflow corre todo DENTRO del
  // mismo step (para no perder el túnel SSM), así que no puede leer outputs de step;
  // un archivo con `true`/`false` es la forma limpia de pasar la decisión.
  const outFlag = argv.findIndex((a) => a === '--out');
  const out = outFlag >= 0 ? argv[outFlag + 1] : undefined;
  return { command, force: argv.includes('--force'), out };
}

/** Última migración aplicada. Es lo que cubre el caso (b): migración nueva ⇒ backfill. */
async function readMigrationTag(db: Database): Promise<string> {
  const rows = await db.execute<{ hash: string; created_at: string | number | null }>(
    sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  );
  const row = (rows as unknown as { hash: string; created_at: unknown }[])[0];
  if (!row) return 'sin-migraciones';
  return `${String(row.created_at)}:${row.hash}`;
}

async function readStamp(db: Database): Promise<typeof readModelStamps.$inferSelect | null> {
  const rows = await db.select().from(readModelStamps).where(eq(readModelStamps.id, STAMP_ID));
  return rows[0] ?? null;
}

/**
 * Cuenta, POR ORG, cuántas evaluaciones distintas hay en el read-model y cuántas tienen
 * resultados por alumno.
 *
 * ⚠️ Dos precauciones, y las dos hacen falta (CLAUDE.md §5.2 y §11):
 *  · Corre dentro de `withOrgContext`, porque ambas tablas tienen RLS y sin contexto un
 *    rol SUJETO a RLS vería 0 filas.
 *  · Filtra ADEMÁS por `assessments.org_id` explícito, porque el rol del pipeline
 *    (`soe_admin`) BYPASSA RLS: sin el filtro, cada iteración devolvería el total global
 *    y la suma contaría el mismo número una vez por org. No es hipotético — la primera
 *    versión de este script reportaba 220 evaluaciones donde había 20.
 */
async function countCoverage(db: Database): Promise<{ inReadModel: number; withResults: number }> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  let inReadModel = 0;
  let withResults = 0;

  for (const org of orgs) {
    const [stats, results] = await withOrgContext(db, org.id, async (tx) => {
      const s = await tx
        .select({ n: sql<number>`count(DISTINCT ${assessmentItemStats.assessmentId})::int` })
        .from(assessmentItemStats)
        .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
        .where(eq(assessments.orgId, org.id));
      const r = await tx
        .select({ n: sql<number>`count(DISTINCT ${assessmentResults.assessmentId})::int` })
        .from(assessmentResults)
        .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
        // `aggregate_only` no deriva del read-model computado: incluirlas haría que el
        // smoke check avise de una "cobertura faltante" que es correcta por diseño.
        .where(
          and(eq(assessments.orgId, org.id), ne(assessments.dataGranularity, 'aggregate_only')),
        );
      return [Number(s[0]?.n ?? 0), Number(r[0]?.n ?? 0)] as const;
    });
    inReadModel += stats;
    withResults += results;
  }

  return { inReadModel, withResults };
}

function emitOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  console.log(`[cohort-stamp] ${name}=${value}`);
}

async function runCheck(db: Database, force: boolean, out?: string): Promise<void> {
  const repoRoot = findRepoRoot(__dirname);
  const { hash, files } = computeFingerprint(repoRoot);
  const migrationTag = await readMigrationTag(db);

  let stamp: Awaited<ReturnType<typeof readStamp>> = null;
  let stampReadable = true;
  try {
    stamp = await readStamp(db);
  } catch (err) {
    // La tabla puede no existir todavía (primer deploy con el gate, o BDD anterior a la
    // migración). Ante la duda: correr el backfill.
    stampReadable = false;
    console.warn('[cohort-stamp] no pude leer read_model_stamps:', err);
  }

  console.log(`[cohort-stamp] huella actual: ${hash} (${files.length} archivos en el cierre)`);
  console.log(`[cohort-stamp] migración aplicada: ${migrationTag}`);
  console.log(
    stamp
      ? `[cohort-stamp] estampado: huella ${stamp.calculatorHash}, migración ${stamp.migrationTag}, ` +
          `${stamp.assessmentsCount} evaluación(es), ${stamp.backfilledAt.toISOString()}`
      : '[cohort-stamp] estampado: ninguno',
  );

  const reasons: string[] = [];
  if (force) reasons.push('forzado a mano (force_backfill)');
  if (!stampReadable) reasons.push('no se pudo leer el estampado');
  if (stampReadable && !stamp)
    reasons.push('sin estampado previo (BDD nueva, restore o primer deploy del gate)');
  if (stamp && stamp.calculatorHash !== hash) reasons.push('cambió la semántica del recálculo');
  if (stamp && stamp.migrationTag !== migrationTag) reasons.push('hay una migración nueva');

  const run = reasons.length > 0;
  if (out) writeFileSync(out, String(run));
  emitOutput('run_backfill', String(run));
  emitOutput('reason', run ? reasons.join('; ') : 'read-model al día');
  console.log(
    run
      ? `[cohort-stamp] ▶ CORRE el backfill — ${reasons.join('; ')}`
      : '[cohort-stamp] ⏭ se OMITE el backfill — read-model al día (huella y migración coinciden)',
  );
}

async function runWrite(db: Database): Promise<void> {
  const repoRoot = findRepoRoot(__dirname);
  const { hash } = computeFingerprint(repoRoot);
  const migrationTag = await readMigrationTag(db);
  const { inReadModel } = await countCoverage(db);
  const now = new Date();

  await db
    .insert(readModelStamps)
    .values({
      id: STAMP_ID,
      calculatorHash: hash,
      migrationTag,
      assessmentsCount: inReadModel,
      backfilledAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: readModelStamps.id,
      set: {
        calculatorHash: hash,
        migrationTag,
        assessmentsCount: inReadModel,
        backfilledAt: now,
        updatedAt: now,
      },
    });

  console.log(
    `[cohort-stamp] ✓ estampado — huella ${hash}, migración ${migrationTag}, ` +
      `${inReadModel} evaluación(es) en el read-model`,
  );
}

async function runVerify(db: Database): Promise<void> {
  const { inReadModel, withResults } = await countCoverage(db);
  let stamp: Awaited<ReturnType<typeof readStamp>> = null;
  try {
    stamp = await readStamp(db);
  } catch {
    // Sin estampado el check igual sirve: lo que importa es que no esté en blanco.
  }

  console.log(
    `[cohort-stamp] read-model: ${inReadModel} evaluación(es); con resultados por alumno: ${withResults}` +
      (stamp ? `; estampado: ${stamp.assessmentsCount}` : ''),
  );

  // ── El caso que este check existe para atrapar: analítica EN BLANCO. ──
  if (withResults > 0 && inReadModel === 0) {
    throw new Error(
      `El read-model de cohorte está VACÍO y hay ${withResults} evaluación(es) con resultados ` +
        `por alumno. Los dashboards mostrarían correctRate null, skills [] y heatmap []. ` +
        `Corré el backfill (workflow_dispatch con force_backfill=true) antes de publicar.`,
    );
  }
  if (stamp && stamp.assessmentsCount > 0 && inReadModel === 0) {
    throw new Error(
      `El read-model quedó vacío pero el último estampado tenía ${stamp.assessmentsCount} ` +
        `evaluación(es). Algo lo borró; NO publiques sin repoblar.`,
    );
  }

  // Cobertura parcial: legítima (alumnos sin matrícula quedan fuera del grano), pero
  // vale avisar. No falla el deploy: un warning que falla se termina ignorando.
  if (withResults > inReadModel) {
    console.warn(
      `[cohort-stamp] ⚠️ ${withResults - inReadModel} evaluación(es) con resultados no aparecen ` +
        `en el read-model. Puede ser legítimo (alumnos sin matrícula) o una deriva; revisá si crece.`,
    );
  }

  console.log('[cohort-stamp] ✓ smoke check OK');
}

async function main(): Promise<void> {
  const { command, force, out } = parseCommand(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL) en el entorno');
  }

  const db = createDbClient(databaseUrl, { maxConnections: 2 });
  try {
    if (command === 'check') await runCheck(db, force, out);
    else if (command === 'write') await runWrite(db);
    else await runVerify(db);
  } finally {
    await db.$client.end({ timeout: 5 }).catch(() => undefined);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[cohort-stamp] falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
