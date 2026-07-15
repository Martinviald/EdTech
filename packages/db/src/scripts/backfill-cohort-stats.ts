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
 * Fase 1 del plan (docs/plan-analitica-agregada-informes-oficiales.md §7): nadie LEE el
 * read-model todavía, así que este backfill no puede cambiar lo que ve un usuario.
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

  const db = createDbClient(databaseUrl);

  const orgRows = args.orgId
    ? [{ id: args.orgId }]
    : await db.select({ id: organizations.id }).from(organizations);

  let orgsTouched = 0;
  let assessmentsDone = 0;
  let itemRowsTotal = 0;
  let skillRowsTotal = 0;
  let orphanTotal = 0;

  console.log(
    `[backfill-cohort-stats] ${orgRows.length} organización(es)${args.dryRun ? ' — DRY RUN' : ''}`,
  );

  for (const org of orgRows) {
    // `withOrgContext` abre una transacción por org: un fallo revierte esa org
    // completa, nunca deja el read-model de una org a medio escribir.
    const summary = await withOrgContext(db, org.id, async (tx) => {
      const conditions = [
        eq(assessments.orgId, org.id),
        ne(assessments.dataGranularity, 'aggregate_only'),
      ];
      if (args.assessmentId) conditions.push(eq(assessments.id, args.assessmentId));

      const rows = await tx
        .select({ id: assessments.id, name: assessments.name })
        .from(assessments)
        .where(and(...conditions));

      let itemStatRows = 0;
      let skillStatRows = 0;
      let orphans = 0;
      for (const a of rows) {
        if (args.dryRun) {
          console.log(
            `  · ${org.id} / ${a.id} (${a.name ?? 'sin nombre'}) — dry run, sin escribir`,
          );
          continue;
        }
        const res = await backfillAssessment(tx, a.id);
        itemStatRows += res.itemRows;
        skillStatRows += res.skillRows;
        orphans += res.orphanResponses;
        console.log(
          `  · ${a.id} (${a.name ?? 'sin nombre'}) → ${res.itemRows} item stats, ${res.skillRows} skill stats` +
            (res.orphanResponses > 0
              ? ` — ⚠️ ${res.orphanResponses} respuesta(s) de alumnos sin curso, fuera del read-model`
              : ''),
        );
      }
      return { assessments: rows.length, items: itemStatRows, skills: skillStatRows, orphans };
    });

    if (summary.assessments > 0) {
      orgsTouched += 1;
      assessmentsDone += summary.assessments;
      itemRowsTotal += summary.items;
      skillRowsTotal += summary.skills;
      orphanTotal += summary.orphans;
      console.log(`[backfill-cohort-stats] org ${org.id}: ${summary.assessments} evaluación(es)`);
    }
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
