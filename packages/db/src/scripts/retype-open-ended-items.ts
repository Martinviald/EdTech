/**
 * Re-tipifica ítems cargados como `open_ended` que en realidad son evaluados por
 * pauta: la respuesta ingresada es el CÓDIGO del nivel que asignó quien corrigió,
 * no un texto a corregir. Pasan a `rubric_scored` y quedan autocorregibles.
 *
 * La detección es por DATO, no por nombre ni por posición: un ítem califica si
 * todas sus respuestas no vacías están dentro de los códigos de la escala. Un
 * ítem con cualquier valor fuera de la escala NO se toca — puede ser una
 * respuesta corta con clave, que necesita la pauta de la ficha técnica.
 *
 * Actualiza IN PLACE (nunca borra y recrea): re-importar el instrumento
 * regeneraría los UUID de los ítems y orfanaría sus tags y respuestas.
 *
 *   Dry-run:  DATABASE_ADMIN_URL=... pnpm --filter @soe/db exec tsx "src/scripts/retype-open-ended-items.ts"
 *   Commit:   ... --commit
 *
 * Args: --org=<uuid> --year=<año> --levels=<code:credit,...>
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, sql as dsql } from 'drizzle-orm';
import * as schema from '../schema';
import { withOrgContext } from '../with-org-context';
import { items } from '../schema/items';
import { instruments } from '../schema/instruments';
import { responses } from '../schema/responses';
import { assessments } from '../schema/assessments';
import { rubricScoredContentSchema } from '@soe/types';

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001');
const YEAR = parseInt(opt('year', '2026'), 10);

/**
 * Escala por defecto: la codificación oficial de la Agencia (Código 2/1/0). No
 * está hardcodeada en el modelo — se declara acá y viaja al `content` del ítem,
 * así otra escala sólo cambia este argumento.
 */
const LEVELS = opt('levels', '0:0,1:0.5,2:1')
  .split(',')
  .map((pair) => {
    const [code, credit] = pair.split(':');
    if (!code || credit === undefined) throw new Error(`Nivel mal formado: "${pair}"`);
    return { code: code.trim(), creditFraction: Number(credit) };
  });
const LEVEL_LABELS: Record<string, string> = {
  '0': 'Incorrecta',
  '1': 'Parcialmente correcta',
  '2': 'Correcta',
};

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = postgres(url, {
  max: 1,
  connect_timeout: 15,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});
const db = drizzle(client, { schema });

function promptOf(content: unknown): string {
  const c = content as { prompt?: unknown; stem?: unknown } | null;
  if (typeof c?.prompt === 'string' && c.prompt.trim()) return c.prompt;
  if (typeof c?.stem === 'string' && c.stem.trim()) return c.stem;
  return 'Pregunta de desarrollo';
}

async function main() {
  const codes = new Set(LEVELS.map((l) => l.code));

  await withOrgContext(db, ORG_ID, async (tx) => {
    const candidates = await tx
      .select({
        id: items.id,
        position: items.position,
        content: items.content,
        instrumentName: instruments.name,
      })
      .from(items)
      .innerJoin(instruments, eq(instruments.id, items.instrumentId))
      .where(
        and(
          eq(items.type, 'open_ended'),
          eq(instruments.year, YEAR),
          dsql`${items.deletedAt} is null`,
          dsql`${instruments.deletedAt} is null`,
        ),
      );
    if (candidates.length === 0) {
      console.log(`No hay ítems open_ended en instrumentos de ${YEAR}.`);
      return;
    }

    const vocab = await tx
      .select({
        itemId: responses.itemId,
        answer: dsql<string | null>`${responses.value}->>'answer'`,
        n: dsql<number>`count(*)::int`,
      })
      .from(responses)
      .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
      .where(
        and(
          eq(assessments.orgId, ORG_ID),
          inArray(
            responses.itemId,
            candidates.map((c) => c.id),
          ),
        ),
      )
      .groupBy(responses.itemId, dsql`${responses.value}->>'answer'`);

    const valuesByItem = new Map<string, Set<string>>();
    for (const row of vocab) {
      const answer = row.answer?.trim();
      if (!answer) continue;
      const set = valuesByItem.get(row.itemId) ?? new Set<string>();
      set.add(answer);
      valuesByItem.set(row.itemId, set);
    }

    const toRetype: typeof candidates = [];
    const skipped: Array<{ item: (typeof candidates)[number]; reason: string }> = [];
    for (const item of candidates) {
      const values = valuesByItem.get(item.id);
      if (!values || values.size === 0) {
        skipped.push({ item, reason: 'sin respuestas cargadas' });
        continue;
      }
      const outside = [...values].filter((v) => !codes.has(v));
      if (outside.length > 0) {
        skipped.push({
          item,
          reason: `valores fuera de la escala: ${outside.slice(0, 5).join(', ')}`,
        });
        continue;
      }
      toRetype.push(item);
    }

    console.log(
      `\n== Re-tipificación open_ended → rubric_scored · ${YEAR} · ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ==`,
    );
    console.log(`  escala: ${LEVELS.map((l) => `${l.code}→${l.creditFraction}`).join('  ')}`);
    console.log(`  candidatos open_ended: ${candidates.length}`);
    console.log(`  a re-tipificar: ${toRetype.length}\n`);
    for (const item of toRetype) {
      console.log(`    ✓ ${item.instrumentName} · pos ${item.position}`);
    }
    if (skipped.length) {
      console.log(
        `\n  se dejan como open_ended (${skipped.length}) — requieren la clave de la ficha técnica:`,
      );
      for (const s of skipped) {
        console.log(`    · ${s.item.instrumentName} · pos ${s.item.position} — ${s.reason}`);
      }
    }

    if (!COMMIT) {
      console.log('\n(dry-run: no se escribió nada. Re-corre con --commit)');
      return;
    }
    if (toRetype.length === 0) return;

    for (const item of toRetype) {
      const content = rubricScoredContentSchema.parse({
        prompt: promptOf(item.content),
        levels: LEVELS.map((l) => ({
          code: l.code,
          label: LEVEL_LABELS[l.code],
          creditFraction: l.creditFraction,
        })),
      });
      await tx
        .update(items)
        .set({ type: 'rubric_scored', content, updatedAt: new Date() })
        .where(eq(items.id, item.id));
    }

    console.log(`\n✅ COMMIT: ${toRetype.length} ítems re-tipificados a rubric_scored`);
    console.log('   Recuerda re-correr la ingesta de respuestas y el backfill del read-model.');
  });

  await client.end();
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
