/**
 * Actualiza `items.scoring_config.altImageRefs` de los ensayos PAES desde los JSON de
 * `data/instruments-paes/`, con UPDATE **en sitio**.
 *
 * Es el gemelo de `update-paes-image-refs.ts` para los recortes POR ALTERNATIVA: los ítems
 * cuyas alternativas SON figuras (estructuras químicas, figuras geométricas, gráficos), que
 * quedaron en la BDD con un placeholder porque `pdftotext` no devuelve texto para ellas.
 *
 * ⚠️ NO re-importar para esto: `import-instruments.ts` borra y recrea el árbol del
 * instrumento, y `item_taxonomy_tags.node_id` tiene ON DELETE CASCADE → se perderían los
 * tags ya aplicados.
 *
 * NO se toca el `text` de la alternativa: el placeholder es hoy lo único que le dice al
 * lector que ahí había algo, y quitarlo antes de que la UI sirva la imagen dejaría al ítem
 * sin figura y sin texto.
 *
 * Idempotente: sólo escribe donde el mapa cambió. Reporta lo que no resolvió.
 *
 * Uso: DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db exec tsx src/seed/update-paes-alt-image-refs.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readdirSync, readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { instruments } from '../schema/instruments';
import { items } from '../schema/items';

const DATA_DIR = resolve(__dirname, '../../data/instruments-paes');

type Json = {
  sections: {
    items: { position: number; alternatives?: { key: string; imageRef?: string | null }[] }[];
  }[];
};

type Refs = Record<string, string>;

/** Compara dos mapas {A: key, …} sin depender del orden de las claves. */
function iguales(a: Refs | undefined, b: Refs): boolean {
  if (!a) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

export async function updatePaesAltImageRefs(db: Database): Promise<void> {
  const deseado = new Map<string, Map<number, Refs>>();
  for (const entry of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(DATA_DIR, entry.name);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const d = JSON.parse(readFileSync(resolve(dir, f), 'utf-8')) as Json;
      const porPos = new Map<number, Refs>();
      for (const s of d.sections) {
        for (const it of s.items) {
          const refs: Refs = {};
          for (const alt of it.alternatives ?? []) {
            if (alt.imageRef) refs[alt.key] = alt.imageRef;
          }
          if (Object.keys(refs).length) porPos.set(it.position, refs);
        }
      }
      if (porPos.size) deseado.set(f, porPos);
    }
  }

  const instRows = await db
    .select({ id: instruments.id, config: instruments.config })
    .from(instruments)
    .where(eq(instruments.type, 'paes'));
  const porSource = new Map<string, string>();
  for (const r of instRows) {
    const src = (r.config as { sourceJson?: string } | null)?.sourceJson;
    if (src) porSource.set(src, r.id);
  }

  let actualizados = 0,
    iguales_ = 0,
    alternativas = 0;
  const sinInstrumento: string[] = [];
  const sinItem: string[] = [];

  for (const [source, porPos] of deseado) {
    const instId = porSource.get(source);
    if (!instId) {
      sinInstrumento.push(source);
      continue;
    }
    const filas = await db
      .select({ id: items.id, position: items.position, scoringConfig: items.scoringConfig })
      .from(items)
      .where(eq(items.instrumentId, instId));
    const porPosicion = new Map(filas.map((f) => [f.position, f]));
    for (const [pos, refs] of porPos) {
      const fila = porPosicion.get(pos);
      if (!fila) {
        sinItem.push(`${source}#${pos}`);
        continue;
      }
      alternativas += Object.keys(refs).length;
      const actual = (fila.scoringConfig as { altImageRefs?: Refs } | null)?.altImageRefs;
      if (iguales(actual, refs)) {
        iguales_++;
        continue;
      }
      await db
        .update(items)
        .set({
          scoringConfig: sql`coalesce(${items.scoringConfig}, '{}'::jsonb) || ${JSON.stringify({ altImageRefs: refs })}::jsonb`,
        })
        .where(eq(items.id, fila.id));
      actualizados++;
    }
  }

  console.log(
    `altImageRefs: ${actualizados} ítems actualizados, ${iguales_} ya estaban al día ` +
      `(${alternativas} alternativas en los JSON).`,
  );
  if (sinInstrumento.length)
    console.log(`  ⚠ sin instrumento en BDD: ${sinInstrumento.join(', ')}`);
  if (sinItem.length) console.log(`  ⚠ sin ítem en BDD: ${sinItem.join(', ')}`);
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  updatePaesAltImageRefs(createDbClient(url))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('ERROR:', e);
      process.exit(1);
    });
}
