/**
 * Carga las claves de respuesta corta que la extracción ya tenía y el cargador de
 * instrumentos nunca copió.
 *
 * Los ítems de completación traen su clave en `fillAnswer` (69 de 70 en las
 * extracciones 2026), pero el importador sólo miraba `correctKey` —que en estos
 * ítems es null— y los dejaba como `open_ended`, sin nada con qué corregir. Este
 * script las trae, pasa el ítem a `short_answer` y lo deja autocorregible.
 *
 * NO convierte todo lo que encuentra. Exige dos cosas, y reporta una por una las
 * que deja fuera:
 *
 *  · Que la clave sea interpretable como cantidad (`inferComparisonMode`). Las
 *    claves que son un par de coordenadas ("(5,6)") o un orden ("3-1-4-2") no lo
 *    son: el comparador todavía no entiende esos formatos y convertirlas ahora
 *    dejaría al ítem en 0% culpando a los alumnos de un problema de notación.
 *  · Que el dato no la contradiga. Se simula la corrección contra las respuestas
 *    ya cargadas y se exige un piso de acierto (`--min-agreement`). Cuando la
 *    mayoría del curso converge en un valor que NO es la clave, lo más probable
 *    es que la equivocada sea la clave; eso se revisa contra el cuadernillo, no
 *    se cierra a ciegas.
 *
 * Actualiza IN PLACE (nunca borra y recrea): re-importar el instrumento
 * regeneraría los UUID de los ítems y orfanaría sus tags y respuestas.
 *
 *   Dry-run: DATABASE_ADMIN_URL=... pnpm --filter @soe/db exec tsx \
 *              src/scripts/load-fill-answers.ts --extraction=<dir>
 *   Commit:  ... --commit
 *
 * Args: --extraction=<dir> --org=<uuid> --year=<año> --min-agreement=<0..1>
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray, sql as dsql } from 'drizzle-orm';
import * as schema from '../schema';
import { withOrgContext } from '../with-org-context';
import { items } from '../schema/items';
import { instruments } from '../schema/instruments';
import { responses } from '../schema/responses';
import { assessments } from '../schema/assessments';
import { inferComparisonMode, matchesAcceptedAnswer, shortAnswerContentSchema } from '@soe/types';

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const opt = (name: string, def: string): string => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const ORG_ID = opt('org', 'c5c10000-0000-0000-0000-000000000001');
const YEAR = parseInt(opt('year', '2026'), 10);
const EXTRACTION_DIR = opt('extraction', '');
if (!EXTRACTION_DIR) {
  throw new Error('Falta --extraction=<dir con los JSON de la ficha técnica>');
}

/**
 * Piso de acierto. Los ítems que sí calzan van de 23% a 92%; los que huelen a
 * clave equivocada están en 0-7%. El corte va en el hueco, no pegado a ninguno.
 */
const MIN_AGREEMENT = Number(opt('min-agreement', '0.15'));
if (!Number.isFinite(MIN_AGREEMENT) || MIN_AGREEMENT < 0 || MIN_AGREEMENT > 1) {
  throw new Error(`--min-agreement debe estar en [0, 1]; llegó "${MIN_AGREEMENT}"`);
}

/**
 * Ítems cuya clave alguien ya contrastó contra el cuadernillo y la ficha, y que
 * por eso saltan el piso de acierto. Se declaran uno a uno —`--confirmed=5°:7,…`—
 * y no con un `--min-agreement=0` global: bajar el piso apagaría el guardarraíl
 * también para la próxima clave mala que aparezca, y no dejaría registro de qué
 * se revisó. Un ítem acá dice "esto lo miró una persona", no "esto da lo mismo".
 *
 * El patrón matchea por substring del nombre del instrumento + posición exacta.
 */
const CONFIRMED = opt('confirmed', '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const at = entry.lastIndexOf(':');
    const pattern = entry.slice(0, at).trim();
    const position = Number(entry.slice(at + 1));
    if (at < 0 || !pattern || !Number.isInteger(position)) {
      throw new Error(`--confirmed mal formado en "${entry}"; se espera <instrumento>:<posición>`);
    }
    return { pattern, position };
  });

function isConfirmed(instrumentName: string, position: number): boolean {
  return CONFIRMED.some((c) => c.position === position && instrumentName.includes(c.pattern));
}

/**
 * Restringe la corrida a ciertos instrumentos (substring del nombre). La BDD demo
 * la comparten varias sesiones: sin esto, una corrida "de todo 2026" re-tipifica
 * ítems de una carga ajena en curso y le deja las respuestas pendientes hasta que
 * esa sesión re-corra su ingesta. Vacío = todos.
 */
const ONLY = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isInScope(instrumentName: string): boolean {
  return ONLY.length === 0 || ONLY.some((pattern) => instrumentName.includes(pattern));
}

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_ADMIN_URL');
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = postgres(url, {
  max: 1,
  connect_timeout: 15,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});
const db = drizzle(client, { schema });

type ExtractedItem = { position: number; fillAnswer?: string | null; stem?: string | null };

function jsonFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsonFilesIn(full));
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

/** instrumento → posición → ítem de la extracción. */
function indexExtraction(dir: string): Map<string, Map<number, ExtractedItem>> {
  const index = new Map<string, Map<number, ExtractedItem>>();
  for (const file of jsonFilesIn(dir)) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      instrument?: { name?: string };
      sections?: Array<{ items?: ExtractedItem[] }>;
    };
    const name = parsed.instrument?.name;
    if (!name) continue;
    const byPosition = index.get(name) ?? new Map<number, ExtractedItem>();
    for (const section of parsed.sections ?? []) {
      for (const item of section.items ?? []) byPosition.set(item.position, item);
    }
    index.set(name, byPosition);
  }
  return index;
}

/**
 * `"21/10 o equivalente"` → `["21/10"]`, `"4/8 o 2/4 o equivalente"` → `["4/8", "2/4"]`.
 * La ficha escribe las alternativas separadas por " o " y cierra con "o equivalente",
 * que es una nota para quien corrige y no una respuesta más.
 */
function acceptedAnswersOf(fillAnswer: string): string[] {
  return fillAnswer
    .replace(/\s*\bo\s+equivalente\b/gi, '')
    .split(/\s+\bo\b\s+/i)
    .map((value) => value.trim())
    .filter(Boolean);
}

function promptOf(content: unknown, fallback: string): string {
  const c = content as { prompt?: unknown; stem?: unknown } | null;
  if (typeof c?.prompt === 'string' && c.prompt.trim()) return c.prompt;
  if (typeof c?.stem === 'string' && c.stem.trim()) return c.stem;
  return fallback;
}

async function main() {
  const extraction = indexExtraction(EXTRACTION_DIR);
  console.log(
    `\n== Carga de claves de respuesta corta · ${YEAR} · ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ==`,
  );
  console.log(`  extracciones indexadas: ${extraction.size} instrumentos`);
  console.log(`  piso de acierto: ${(MIN_AGREEMENT * 100).toFixed(0)}%\n`);

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

    const answered = await tx
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

    const answersByItem = new Map<string, Array<{ answer: string; n: number }>>();
    for (const row of answered) {
      const answer = row.answer?.trim();
      if (!answer) continue;
      const list = answersByItem.get(row.itemId) ?? [];
      list.push({ answer, n: Number(row.n) });
      answersByItem.set(row.itemId, list);
    }

    type Candidate = (typeof candidates)[number];
    const toConvert: Array<{
      item: Candidate;
      accepted: string[];
      comparison: 'numeric' | 'sequence';
      agreement: number;
      total: number;
    }> = [];
    const held: Array<{ item: Candidate; reason: string }> = [];

    for (const item of candidates) {
      if (!isInScope(item.instrumentName)) continue;
      const extracted = extraction.get(item.instrumentName)?.get(item.position);
      const fillAnswer = extracted?.fillAnswer?.trim();
      if (!fillAnswer) {
        held.push({ item, reason: 'la extracción no trae fillAnswer' });
        continue;
      }

      const accepted = acceptedAnswersOf(fillAnswer);
      if (accepted.length === 0) {
        held.push({ item, reason: `clave vacía tras normalizar ("${fillAnswer}")` });
        continue;
      }
      const comparison = inferComparisonMode(accepted);
      if (comparison === 'text') {
        held.push({
          item,
          reason: `la clave "${fillAnswer}" no es ni una cantidad ni una secuencia — se corrige a mano`,
        });
        continue;
      }

      const observed = answersByItem.get(item.id) ?? [];
      const total = observed.reduce((sum, o) => sum + o.n, 0);
      if (total === 0) {
        held.push({ item, reason: 'sin respuestas para contrastar la clave' });
        continue;
      }
      let hits = 0;
      for (const { answer, n } of observed) {
        if (matchesAcceptedAnswer(answer, accepted) === 'match') hits += n;
      }
      const agreement = hits / total;
      if (agreement < MIN_AGREEMENT && !isConfirmed(item.instrumentName, item.position)) {
        const modal = observed.reduce((a, b) => (b.n > a.n ? b : a));
        held.push({
          item,
          reason:
            `el dato contradice la clave "${fillAnswer}": ${(agreement * 100).toFixed(0)}% de acierto ` +
            `y la respuesta más frecuente es "${modal.answer}" (${modal.n} de ${total}) — revisar contra el cuadernillo`,
        });
        continue;
      }

      toConvert.push({ item, accepted, comparison, agreement, total });
    }

    const inScope = candidates.filter((c) => isInScope(c.instrumentName));
    console.log(
      `  candidatos open_ended: ${inScope.length}` +
        (ONLY.length ? ` (de ${candidates.length}; --only=${ONLY.join(', ')})` : ''),
    );
    console.log(`  a convertir en short_answer: ${toConvert.length}\n`);
    for (const { item, accepted, agreement } of toConvert) {
      const mark = isConfirmed(item.instrumentName, item.position)
        ? ' · clave verificada a mano'
        : '';
      console.log(
        `    ✓ ${item.instrumentName.replace('DIA ', '')} · pos ${item.position} · clave=${accepted.join(' | ')} · acierto=${(agreement * 100).toFixed(0)}%${mark}`,
      );
    }
    if (held.length) {
      console.log(`\n  se dejan como open_ended (${held.length}):`);
      for (const h of held) {
        console.log(
          `    · ${h.item.instrumentName.replace('DIA ', '')} · pos ${h.item.position} — ${h.reason}`,
        );
      }
    }

    if (!COMMIT) {
      console.log('\n(dry-run: no se escribió nada. Re-corre con --commit)');
      return;
    }
    if (toConvert.length === 0) return;

    for (const { item, accepted, comparison } of toConvert) {
      const extracted = extraction.get(item.instrumentName)?.get(item.position);
      const content = shortAnswerContentSchema.parse({
        prompt: promptOf(item.content, extracted?.stem ?? 'Pregunta de respuesta corta'),
        acceptedAnswers: accepted,
        comparison,
      });
      await tx
        .update(items)
        .set({ type: 'short_answer', content, updatedAt: new Date() })
        .where(eq(items.id, item.id));
    }

    console.log(`\n✅ COMMIT: ${toConvert.length} ítems convertidos a short_answer`);
    console.log('   Recuerda re-correr la ingesta de respuestas y el backfill del read-model.');
  });

  await client.end();
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
