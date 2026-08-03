/**
 * Re-tipa in-place los ítems que se cargaron con el tipo equivocado porque el
 * importador aún no sabía producirlos:
 *
 *   · términos pareados → `open_ended` + `responseFormat: match_pairs`  ⇒ `matching`
 *   · Verdadero/Falso   → `multiple_choice` con alternativas V/F        ⇒ `true_false`
 *
 * ⚠️ NO re-importa: `import-instruments` borra y recrea, regenera los UUID y se
 * lleva los `item_taxonomy_tags` por ON DELETE CASCADE (~4.900 tags en la tanda
 * 2026). Acá se hace UPDATE sobre la fila existente, así que los tags, las
 * figuras y cualquier referencia a `items.id` sobreviven.
 *
 * Los pares se leen de `scoring_config->'matchPairs'`/`'matchColumns'` (lo que el
 * import preservó) y, si el ítem no los tiene, del JSON del instrumento en
 * `packages/db/data/` — el mismo que consume `import-instruments`, así que el
 * script y los datos no pueden divergir. No hace falta volver a los PDF.
 *
 * Idempotente: sólo toca ítems que siguen mal tipados.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db exec tsx \
 *     src/scripts/retype-matching-truefalse-items.ts [--apply]
 *
 * Sin `--apply` corre en dry-run y no escribe nada.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync, readdirSync } from 'node:fs';

const DATA_ROOT = resolve(__dirname, '../../data');

import postgres from 'postgres';
import { validateItemContent } from '@soe/types';

const APPLY = process.argv.includes('--apply');

type MatchElement = { key: string; text: string; isImage?: boolean };
type MatchPair = { left: string; right: string };

type ItemRow = {
  id: string;
  position: number;
  type: string;
  instrumentName: string;
  sourceJson: string | null;
  content: Record<string, unknown>;
  scoringConfig: Record<string, unknown>;
};

function isAnswerableSide(keys: string[], column: MatchElement[]): boolean {
  const unique = new Set(keys);
  return unique.size === keys.length && unique.size === column.length;
}

function labelPrefix(label: string): string {
  return label.replace(/[.\s]?\d+$/, '');
}

/**
 * Fallback para los ítems que no tienen `matchColumns` persistido (la capa A no
 * lo emitió para ese instrumento): las columnas están igual en el enunciado, una
 * etiqueta por línea. Se barre el texto por cada prefijo de los pares, así se
 * recuperan también los distractores, que por definición no aparecen en ellos.
 * Es el mismo fallback que usa `import-instruments`.
 */
function columnsFromText(text: string, pairs: MatchPair[]): Record<string, MatchElement[]> {
  const prefixes = [...new Set(pairs.flatMap((p) => [p.left, p.right]).map(labelPrefix))];
  const columns: Record<string, MatchElement[]> = {};
  for (const prefix of prefixes) {
    const pattern = new RegExp(`^\\s*(${prefix}[.\\s]?\\d+)[.)\\s]+(.+)$`, 'gm');
    const elements: MatchElement[] = [];
    for (const m of text.matchAll(pattern)) {
      const key = m[1]!.replace(/\s+/g, '');
      const value = m[2]!.trim();
      if (value.length > 0) elements.push({ key, text: value });
    }
    if (elements.length > 0) columns[prefix] = elements;
  }
  return columns;
}

type MatchSource = { pairs: MatchPair[]; columns: Record<string, MatchElement[]> };

/**
 * De dónde salen los pares de un ítem: primero de `scoring_config` (lo que el
 * import preservó) y, si no está, del JSON del instrumento en el repo. Devuelve
 * `null` si el ítem no es un pareado — así el barrido puede incluir los `fill_in`
 * sin re-tipar por error los que sí son de completar.
 */
function resolveMatchSource(row: ItemRow, fromJson: Map<string, MatchSource>): MatchSource | null {
  const stored = (row.scoringConfig.matchPairs ?? []) as MatchPair[];
  if (stored.length > 0) {
    return {
      pairs: stored,
      columns: (row.scoringConfig.matchColumns ?? {}) as Record<string, MatchElement[]>,
    };
  }
  return fromJson.get(`${row.sourceJson}#${row.position}`) ?? null;
}

/** Misma regla que el importador: el lado respondible se DEDUCE de los pares. */
function buildMatchingContent(
  row: ItemRow,
  source: MatchSource,
): { content: Record<string, unknown>; points: number } {
  const pairs = source.pairs;
  const text = String(row.content.prompt ?? row.content.stem ?? '');
  const columns =
    Object.keys(source.columns).length > 0 ? source.columns : columnsFromText(text, pairs);
  const names = Object.keys(columns);
  if (pairs.length === 0) throw new Error(`pos ${row.position}: matchPairs vacío`);
  if (names.length !== 2) {
    throw new Error(`pos ${row.position}: se resolvieron ${names.length} columnas, se esperaban 2`);
  }

  const [firstName, secondName] = names as [string, string];
  const first = columns[firstName] ?? [];
  const second = columns[secondName] ?? [];
  const leftIsAnswerable = isAnswerableSide(
    pairs.map((p) => p.left),
    first,
  );
  const rightIsAnswerable = isAnswerableSide(
    pairs.map((p) => p.right),
    second,
  );

  if (leftIsAnswerable === rightIsAnswerable && !leftIsAnswerable) {
    throw new Error(
      `pos ${row.position}: no se puede deducir el lado respondible ` +
        `(${pairs.length} pares, columnas de ${first.length} y ${second.length})`,
    );
  }

  const answerable = leftIsAnswerable ? first : second;
  const options = leftIsAnswerable ? second : first;
  const toElement = (el: MatchElement) => ({
    id: el.key,
    text: el.text,
    label: el.key,
    ...(el.isImage ? { isImage: true } : {}),
  });

  return {
    content: {
      prompt: row.content.prompt ?? row.content.stem ?? '',
      leftItems: answerable.map(toElement),
      rightItems: options.map(toElement),
      correctPairs: pairs.map((p) => ({
        leftId: leftIsAnswerable ? p.left : p.right,
        rightId: leftIsAnswerable ? p.right : p.left,
      })),
    },
    points: pairs.length,
  };
}

function buildTrueFalseContent(row: ItemRow): Record<string, unknown> {
  const alternatives = (row.content.alternatives ?? []) as {
    key: string;
    text: string;
    isCorrect?: boolean;
  }[];
  const correct = alternatives.find((a) => a.isCorrect === true);
  if (!correct) throw new Error(`pos ${row.position}: V/F sin alternativa correcta`);
  const normalized = `${correct.key} ${correct.text}`.trim().toUpperCase();
  const isTrue = /\b(V|VERDADERO|TRUE|T)\b/.test(normalized);
  const isFalse = /\b(F|FALSO|FALSE)\b/.test(normalized);
  if (isTrue === isFalse) {
    throw new Error(`pos ${row.position}: V/F ambiguo en "${correct.key}. ${correct.text}"`);
  }
  return { stem: row.content.stem ?? row.content.prompt ?? '', correctAnswer: isTrue };
}

/**
 * Índice (sourceJson, position) → pares del JSON del instrumento.
 *
 * Hay ítems pareados cuyo `scoring_config` NO tiene `matchPairs`: se cargaron
 * antes de que el import los preservara, o su extracción escribía la clave en
 * otra notación. Para ésos, el JSON del repo es la fuente — y como el mismo JSON
 * es el que consume `import-instruments`, script y datos no pueden divergir.
 */
function indexPairsFromDataDir(): Map<
  string,
  { pairs: MatchPair[]; columns: Record<string, MatchElement[]> }
> {
  const index = new Map<string, { pairs: MatchPair[]; columns: Record<string, MatchElement[]> }>();
  const roots = readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('instruments'))
    .map((e) => resolve(DATA_ROOT, e.name));

  for (const root of roots) {
    for (const file of collectJsonFiles(root)) {
      let parsed: {
        sections?: { items?: Record<string, unknown>[] }[];
        pauta?: { source?: { instrumentJson?: string } };
      };
      try {
        parsed = JSON.parse(readFileSync(file, 'utf-8'));
      } catch {
        continue;
      }
      const sourceJson = parsed.pauta?.source?.instrumentJson;
      if (!sourceJson || !Array.isArray(parsed.sections)) continue;
      for (const section of parsed.sections) {
        for (const item of section.items ?? []) {
          const pairs = item.matchPairs as MatchPair[] | undefined;
          if (!pairs?.length) continue;
          index.set(`${sourceJson}#${item.position as number}`, {
            pairs,
            columns: (item.matchColumns ?? {}) as Record<string, MatchElement[]>,
          });
        }
      }
    }
  }
  return index;
}

function collectJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsonFiles(full));
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

const sql = postgres(process.env.DATABASE_ADMIN_URL as string, { max: 1 });

(async () => {
  const fromJson = indexPairsFromDataDir();

  const pareados = (await sql`
    select it.id, it.position, it.type, ins.name as "instrumentName",
           ins.config->>'sourceJson' as "sourceJson",
           it.content, it.scoring_config as "scoringConfig"
    from items it join instruments ins on ins.id = it.instrument_id
    where it.deleted_at is null and it.type <> 'matching'
      and (it.scoring_config ? 'matchPairs'
           or it.scoring_config->>'responseFormat' in ('match_pairs', 'fill_in'))
    order by ins.name, it.position`) as unknown as ItemRow[];

  const vf = (await sql`
    select it.id, it.position, it.type, ins.name as "instrumentName",
           it.content, it.scoring_config as "scoringConfig"
    from items it join instruments ins on ins.id = it.instrument_id
    where it.deleted_at is null and it.type = 'multiple_choice'
      and jsonb_array_length(it.content->'alternatives') = 2
      and it.content->'alternatives' @> '[{"text":"Verdadero"}]'
      and it.content->'alternatives' @> '[{"text":"Falso"}]'
    order by ins.name, it.position`) as unknown as ItemRow[];

  console.log(
    `${APPLY ? 'APLICANDO' : 'DRY-RUN'} · pareados=${pareados.length} · V/F=${vf.length}\n`,
  );

  const planned: { id: string; type: string; content: unknown; points: number; label: string }[] =
    [];

  let noPareados = 0;
  for (const row of pareados) {
    const source = resolveMatchSource(row, fromJson);
    if (!source) {
      noPareados++;
      continue;
    }
    const { content, points } = buildMatchingContent(row, source);
    validateItemContent('matching', content);
    planned.push({
      id: row.id,
      type: 'matching',
      content,
      points,
      label: `${row.instrumentName} pos ${row.position}: ${row.type} → matching (points ${row.scoringConfig.points ?? 1} → ${points})`,
    });
  }

  for (const row of vf) {
    const content = buildTrueFalseContent(row);
    validateItemContent('true_false', content);
    planned.push({
      id: row.id,
      type: 'true_false',
      content,
      points: Number(row.scoringConfig.points ?? 1),
      label: `${row.instrumentName} pos ${row.position}: multiple_choice → true_false (correctAnswer=${content.correctAnswer})`,
    });
  }

  planned.forEach((p) => console.log('  ' + p.label));
  if (noPareados > 0) {
    console.log(
      `\n  (${noPareados} ítem(s) con responseFormat fill_in/match_pairs SIN pares declarados: no son pareados, se omiten)`,
    );
  }

  if (!APPLY) {
    console.log('\nDry-run: nada escrito. Re-correr con --apply.');
    await sql.end();
    return;
  }

  await sql.begin(async (tx) => {
    for (const p of planned) {
      const updated = await tx`
        update items
        set type = ${p.type}::item_type,
            content = ${tx.json(p.content as never)},
            scoring_config = scoring_config || ${tx.json({ points: p.points } as never)},
            updated_at = now()
        where id = ${p.id}
        returning id`;
      if (updated.length !== 1)
        throw new Error(`UPDATE afectó ${updated.length} filas para ${p.id}`);
    }
  });

  console.log(`\n✅ ${planned.length} ítems re-tipados.`);
  await sql.end();
})().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
