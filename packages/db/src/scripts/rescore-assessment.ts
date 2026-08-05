/**
 * Re-corrige las respuestas YA CARGADAS de un assessment con la definición actual
 * de sus ítems, y recalcula resultados y read-model.
 *
 * Existe porque re-correr la ingesta no es la herramienta correcta cuando lo único
 * que cambió es el ítem (se le cargó la clave, se re-tipificó): la ingesta borra y
 * recrea el assessment, así que le cambia el UUID y mata cualquier link guardado a
 * esa evaluación. Acá no se toca ni el assessment ni la matrícula ni el matching de
 * alumnos: sólo se vuelve a puntuar lo que ya está.
 *
 * Corrige con `scoreAnswerSheetCell`, la misma función que usa la ingesta, sobre
 * `responses.value->>'answer'` — el valor crudo que el alumno marcó, que se guarda
 * intacto justamente para poder volver a corregir sin re-importar la planilla.
 *
 * NO pisa una corrección humana: las respuestas con `scored_by = 'human'` y puntaje
 * puesto a mano se dejan como están (§8.3 — la IA propone, el humano aprueba).
 *
 *   Dry-run: DATABASE_ADMIN_URL=... pnpm --filter @soe/db exec tsx \
 *              src/scripts/rescore-assessment.ts --assessment=<uuid>
 *   Commit:  ... --commit
 *
 * Args: --assessment=<uuid> (repetible por coma) --org=<uuid>
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, sql as dsql } from 'drizzle-orm';
import * as schema from '../schema';
import { withOrgContext } from '../with-org-context';
import { items, itemTaxonomyTags } from '../schema/items';
import { assessments } from '../schema/assessments';
import { responses } from '../schema/responses';
import { assessmentResults, skillResults } from '../schema/results';
import { recomputeCohortStatsFromResponses } from '../queries/cohort-stats';
import { buildAssessmentResultRows, type ScoredResponse } from '../queries/assessment-result-rows';
import { DEFAULT_GRADING_SCALE, maxScoreOf, scoreAnswerSheetCell } from '@soe/types';
import type { ItemContent, ScoringConfig } from '@soe/types';

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001');
const ASSESSMENT_IDS = opt('assessment', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (ASSESSMENT_IDS.length === 0) throw new Error('Falta --assessment=<uuid>');

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = postgres(url, {
  max: 1,
  connect_timeout: 15,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});
const db = drizzle(client, { schema });

function answerOf(value: unknown): string | null {
  const answer = (value as { answer?: unknown } | null)?.answer;
  return typeof answer === 'string' ? answer : null;
}

async function main() {
  console.log(`\n== Re-corrección de assessments · ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ==\n`);

  await withOrgContext(db, ORG_ID, async (tx) => {
    for (const assessmentId of ASSESSMENT_IDS) {
      const [assessment] = await tx
        .select({
          id: assessments.id,
          name: assessments.name,
          instrumentId: assessments.instrumentId,
        })
        .from(assessments)
        .where(and(eq(assessments.id, assessmentId), eq(assessments.orgId, ORG_ID)));
      if (!assessment) throw new Error(`Assessment ${assessmentId} no existe en esta org`);

      const instrumentItems = await tx
        .select({
          id: items.id,
          position: items.position,
          type: items.type,
          content: items.content,
          scoringConfig: items.scoringConfig,
        })
        .from(items)
        .where(
          and(eq(items.instrumentId, assessment.instrumentId), dsql`${items.deletedAt} is null`),
        );
      const itemById = new Map(instrumentItems.map((i) => [i.id, i]));

      const tags = await tx
        .select({ itemId: itemTaxonomyTags.itemId, nodeId: itemTaxonomyTags.nodeId })
        .from(itemTaxonomyTags)
        .where(
          inArray(
            itemTaxonomyTags.itemId,
            instrumentItems.map((i) => i.id),
          ),
        );
      const nodesByItem = new Map<string, string[]>();
      for (const t of tags) {
        const list = nodesByItem.get(t.itemId) ?? [];
        list.push(t.nodeId);
        nodesByItem.set(t.itemId, list);
      }

      const current = await tx
        .select({
          id: responses.id,
          studentId: responses.studentId,
          itemId: responses.itemId,
          value: responses.value,
          isCorrect: responses.isCorrect,
          rawScore: responses.rawScore,
          scoredBy: responses.scoredBy,
          humanScore: responses.humanScore,
        })
        .from(responses)
        .where(eq(responses.assessmentId, assessmentId));

      const scored: ScoredResponse[] = [];
      const updates: Array<{
        id: string;
        isCorrect: boolean | null;
        rawScore: string | null;
        maxScore: string;
        finalScore: string | null;
        scoredBy: 'auto' | 'human';
      }> = [];
      let changed = 0;
      let keptHuman = 0;
      const now = new Date();

      for (const r of current) {
        const item = itemById.get(r.itemId);
        if (!item) continue;
        const maxScore = maxScoreOf(item);
        const nodeIds = nodesByItem.get(r.itemId) ?? [];

        const humanGraded = r.scoredBy === 'human' && r.humanScore !== null;
        const outcome = humanGraded
          ? null
          : scoreAnswerSheetCell(
              {
                id: item.id,
                type: item.type,
                content: item.content as ItemContent,
                scoringConfig: item.scoringConfig as ScoringConfig | null,
              },
              answerOf(r.value),
            );
        if (humanGraded) keptHuman += 1;

        const pending =
          outcome === null
            ? r.isCorrect === null
            : outcome.requiresManualGrading ||
              outcome.isCorrect === null ||
              outcome.rawScore === null;
        const isCorrect = outcome === null ? r.isCorrect : pending ? null : outcome.isCorrect;
        const rawScore =
          outcome === null
            ? r.rawScore === null
              ? null
              : Number(r.rawScore)
            : pending
              ? null
              : outcome.rawScore;

        const before = r.rawScore === null ? null : Number(r.rawScore);
        if (outcome !== null && (before !== rawScore || r.isCorrect !== isCorrect)) {
          changed += 1;
          updates.push({
            id: r.id,
            isCorrect,
            rawScore: rawScore === null ? null : rawScore.toFixed(2),
            maxScore: maxScore.toFixed(2),
            finalScore: rawScore === null ? null : rawScore.toFixed(2),
            scoredBy: pending ? 'human' : 'auto',
          });
        }

        scored.push({
          studentId: r.studentId,
          itemId: r.itemId,
          itemPosition: item.position,
          rawScore,
          maxScore,
          finalScore: rawScore,
          isCorrect,
          taxonomyNodeIds: nodeIds,
          value: r.value as Record<string, unknown>,
          hasAlternatives: Array.isArray(
            (item.content as { alternatives?: unknown } | null)?.alternatives,
          ),
        });
      }

      const pendingAfter = scored.filter((s) => s.isCorrect === null).length;
      console.log(`  ${assessment.name}`);
      console.log(
        `    respuestas=${current.length} · cambian=${changed} · pendientes tras re-corregir=${pendingAfter}` +
          (keptHuman ? ` · corregidas a mano que se respetan=${keptHuman}` : ''),
      );

      if (!COMMIT) continue;

      for (const u of updates) {
        await tx
          .update(responses)
          .set({
            isCorrect: u.isCorrect,
            rawScore: u.rawScore,
            maxScore: u.maxScore,
            finalScore: u.finalScore,
            scoredBy: u.scoredBy,
            scoredAt: u.scoredBy === 'auto' ? now : null,
          })
          .where(eq(responses.id, u.id));
      }

      const rows = buildAssessmentResultRows(assessmentId, scored, DEFAULT_GRADING_SCALE, now);
      await tx.delete(assessmentResults).where(eq(assessmentResults.assessmentId, assessmentId));
      await tx.delete(skillResults).where(eq(skillResults.assessmentId, assessmentId));
      if (rows.results.length) await tx.insert(assessmentResults).values(rows.results);
      if (rows.skills.length) await tx.insert(skillResults).values(rows.skills);

      const stats = await recomputeCohortStatsFromResponses(tx, {
        assessmentId,
        responses: scored,
        skillResults: rows.cohortSkills,
      });
      console.log(
        `    ✅ ${updates.length} respuestas actualizadas · ${rows.results.length} resultados · ${stats.itemRows} filas item_stats`,
      );
    }

    if (!COMMIT) console.log('\n(dry-run: no se escribió nada. Re-corre con --commit)');
  });

  await client.end();
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
