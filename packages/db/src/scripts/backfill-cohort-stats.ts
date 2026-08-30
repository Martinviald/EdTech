/**
 * Backfill del read-model de cohorte (`assessment_item_stats` / `assessment_skill_stats`)
 * para los assessments ya existentes.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:backfill:cohort-stats
 *   ... --org <orgId>            # sólo una organización
 *   ... --assessment <id>        # sólo un assessment (implica su org)
 *   ... --dry-run                # calcula y reporta, no escribe
 *
 * Idempotente: cada assessment se recalcula con delete + reinsert, igual que el
 * recálculo en caliente. Correrlo dos veces deja exactamente el mismo estado.
 *
 * Recorre org por org dentro de `withOrgContext` (CLAUDE.md §5.2): ambas tablas tienen
 * RLS por `EXISTS` sobre `assessments.org_id` y sin contexto los INSERT fallan.
 *
 * Resiliencia (el deploy corre esto por un túnel SSM que corta conexiones en
 * operaciones largas — `CONNECTION_CLOSED`): cada assessment se procesa en su PROPIA
 * transacción corta (no una gigante por org) y cada operación se reintenta con
 * reconexión ante cortes transitorios. Como es idempotente, reintentar o re-ejecutar
 * es seguro; un assessment ya recalculado simplemente se vuelve a dejar igual.
 *
 * ⚠️ NO es opcional después de una migración. Desde la Fase 2 los lectores
 * (item-analysis, official-reports, dashboards, heatmap, assessment-report) ya no
 * derivan de `responses`: leen de acá. Migrar sin correr esto deja la analítica en
 * blanco — correctRate null, skills [] y heatmap []. Por eso el deploy lo corre dentro
 * del mismo túnel que la migración y antes de publicar la imagen nueva
 * (.github/workflows/deploy-backend.yml).
 *
 * Dos cosas que no hace, a propósito:
 *  · No recalcula `assessment_results` / `skill_results`. Lee los que ya están y los
 *    agrega por curso. El backfill no debe mover números publicados.
 *  · No toca los assessments `aggregate_only`: su read-model es `imported` y no se
 *    deriva de `responses`. En Fase 1 no existe ninguno, pero el filtro va igual.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { and, eq, ne } from 'drizzle-orm';
import type { SkillResultForCohort } from '@soe/types';
import { createDbClient, type Database } from '../client';
import { withOrgContext } from '../with-org-context';
import { recomputeCohortStatsFromResponses } from '../queries/cohort-stats';
import { assessments } from '../schema/assessments';
import { items } from '../schema/items';
import { organizations } from '../schema/organizations';
import { responses } from '../schema/responses';
import { skillResults } from '../schema/results';

type Args = {
  orgId?: string;
  assessmentId?: string;
  dryRun: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--org') args.orgId = argv[++i];
    else if (flag === '--assessment') args.assessmentId = argv[++i];
  }
  return args;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TRANSIENT_CODES = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
]);

/** Un corte de conexión (túnel SSM que se cae en operaciones largas) es reintentable. */
function isTransient(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code && TRANSIENT_CODES.has(code)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /CONNECTION_CLOSED|CONNECTION_ENDED|ECONNRESET|EPIPE|connection closed|terminating connection|server closed the connection/i.test(
    message,
  );
}

const MAX_ATTEMPTS = 4;

/**
 * Ejecuta `op` reintentando con RECONEXIÓN ante cortes transitorios. Cada intento
 * usa el cliente actual de `holder`; si la conexión se cayó, se abre uno fresco.
 * Los errores no-transitorios (SQL inválido, constraint, etc.) se propagan de una.
 */
async function withDbRetry<T>(
  holder: { db: Database },
  makeDb: () => Database,
  op: (db: Database) => Promise<T>,
  label: string,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await op(holder.db);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isTransient(err)) throw err;
      const waitMs = 1000 * attempt;
      console.warn(
        `[backfill-cohort-stats] ${label}: conexión caída (intento ${attempt}/${MAX_ATTEMPTS}), ` +
          `reconectando en ${waitMs}ms…`,
      );
      await sleep(waitMs);
      holder.db = makeDb();
    }
  }
}

/** Ver la nota de `hasAlternatives` en `@soe/types/utils/item-stats-calculator`. */
function hasAlternatives(content: Record<string, unknown> | null): boolean {
  const alternatives = content?.alternatives;
  return Array.isArray(alternatives) && alternatives.length > 0;
}

async function backfillAssessment(
  tx: Database,
  assessmentId: string,
): Promise<{ itemRows: number; skillRows: number; orphanResponses: number }> {
  const responseRows = await tx
    .select({
      studentId: responses.studentId,
      itemId: responses.itemId,
      value: responses.value,
      itemContent: items.content,
      isCorrect: responses.isCorrect,
      rawScore: responses.rawScore,
      finalScore: responses.finalScore,
      maxScore: responses.maxScore,
    })
    .from(responses)
    .innerJoin(items, eq(items.id, responses.itemId))
    .where(eq(responses.assessmentId, assessmentId));

  const skillRows = await tx
    .select({
      studentId: skillResults.studentId,
      nodeId: skillResults.nodeId,
      correctCount: skillResults.correctCount,
      totalCount: skillResults.totalCount,
      percentage: skillResults.percentage,
    })
    .from(skillResults)
    .where(eq(skillResults.assessmentId, assessmentId));

  // La columna guarda 0..100; el calculador puro trabaja en 0..1.
  const skills: SkillResultForCohort[] = skillRows.map((r) => ({
    studentId: r.studentId,
    nodeId: r.nodeId,
    correctCount: r.correctCount,
    totalCount: r.totalCount,
    percentage: r.percentage === null ? null : Number(r.percentage) / 100,
  }));

  return recomputeCohortStatsFromResponses(tx, {
    assessmentId,
    responses: responseRows.map((r) => ({
      studentId: r.studentId,
      itemId: r.itemId,
      value: r.value,
      hasAlternatives: hasAlternatives(r.itemContent),
      isCorrect: r.isCorrect,
      rawScore: r.rawScore === null ? null : Number(r.rawScore),
      finalScore: r.finalScore === null ? null : Number(r.finalScore),
      maxScore: Number(r.maxScore),
    })),
    skillResults: skills,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL) en el entorno');
  }

  const makeDb = (): Database => createDbClient(databaseUrl);
  const holder = { db: makeDb() };

  const orgRows = args.orgId
    ? [{ id: args.orgId }]
    : await withDbRetry(
        holder,
        makeDb,
        (db) => db.select({ id: organizations.id }).from(organizations),
        'listar organizaciones',
      );

  let orgsTouched = 0;
  let assessmentsDone = 0;
  let itemRowsTotal = 0;
  let skillRowsTotal = 0;
  let orphanTotal = 0;

  console.log(
    `[backfill-cohort-stats] ${orgRows.length} organización(es)${args.dryRun ? ' — DRY RUN' : ''}`,
  );

  for (const org of orgRows) {
    // Listar los assessments de la org (transacción corta con contexto de org).
    const rows = await withDbRetry(
      holder,
      makeDb,
      (db) =>
        withOrgContext(db, org.id, async (tx) => {
          const conditions = [
            eq(assessments.orgId, org.id),
            ne(assessments.dataGranularity, 'aggregate_only'),
          ];
          if (args.assessmentId) conditions.push(eq(assessments.id, args.assessmentId));
          return tx
            .select({ id: assessments.id, name: assessments.name })
            .from(assessments)
            .where(and(...conditions));
        }),
      `org ${org.id}: listar evaluaciones`,
    );

    if (rows.length === 0) continue;
    orgsTouched += 1;

    for (const a of rows) {
      if (args.dryRun) {
        assessmentsDone += 1;
        console.log(`  · ${org.id} / ${a.id} (${a.name ?? 'sin nombre'}) — dry run, sin escribir`);
        continue;
      }

      // Cada assessment en su PROPIA transacción corta, reintentable: si el túnel
      // corta la conexión, se reconecta y se recalcula sólo este assessment (idempotente).
      const res = await withDbRetry(
        holder,
        makeDb,
        (db) => withOrgContext(db, org.id, (tx) => backfillAssessment(tx, a.id)),
        `evaluación ${a.id}`,
      );

      assessmentsDone += 1;
      itemRowsTotal += res.itemRows;
      skillRowsTotal += res.skillRows;
      orphanTotal += res.orphanResponses;
      console.log(
        `  · ${a.id} (${a.name ?? 'sin nombre'}) → ${res.itemRows} item stats, ${res.skillRows} skill stats` +
          (res.orphanResponses > 0
            ? ` — ⚠️ ${res.orphanResponses} respuesta(s) de alumnos sin curso, fuera del read-model`
            : ''),
      );
    }

    console.log(`[backfill-cohort-stats] org ${org.id}: ${rows.length} evaluación(es)`);
  }

  console.log(
    `[backfill-cohort-stats] listo — ${assessmentsDone} evaluación(es) en ${orgsTouched} org(s); ` +
      `${itemRowsTotal} filas en assessment_item_stats, ${skillRowsTotal} en assessment_skill_stats`,
  );
  // Toda respuesta huérfana es una diferencia org-wide contra el `GROUP BY` actual
  // (`attachCorrectRates` sin filtro de curso SÍ las cuenta). Con 0, la paridad de la
  // Fase 2 es exacta; con >0 hay que decidir qué hacer ANTES de mover los lectores.
  if (orphanTotal > 0) {
    console.warn(
      `[backfill-cohort-stats] ⚠️ ${orphanTotal} respuesta(s) de alumnos sin matrícula quedaron ` +
        `FUERA del read-model (el grano exige class_group_id NOT NULL). Los agregados org-wide ` +
        `del read-model serán menores que los de responses en esa cantidad.`,
    );
  } else {
    console.log('[backfill-cohort-stats] 0 respuestas huérfanas — paridad org-wide exacta.');
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[backfill-cohort-stats] falló:', err);
  process.exit(1);
});
