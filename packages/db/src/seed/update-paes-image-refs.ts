/**
 * Actualiza `items.scoring_config.imageRef` de los ensayos PAES desde los JSON de
 * `data/instruments-paes/`, con UPDATE **en sitio**.
 *
 * ⚠️ NO re-importar para esto: `import-instruments.ts` borra y recrea el árbol del
 * instrumento, y `item_taxonomy_tags.node_id` tiene ON DELETE CASCADE → se perderían los
 * tags ya aplicados (y `assertSafeToRecreate` justamente aborta por eso sin `--force`).
 *
 * Idempotente: sólo escribe donde la key cambió. Reporta lo que no resolvió.
 *
 * Uso: DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db exec tsx src/seed/update-paes-image-refs.ts
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
  sections: { items: { position: number; imageRef?: string | null }[] }[];
};

export async function updatePaesImageRefs(db: Database): Promise<void> {
  const deseado = new Map<string, Map<number, string>>();
  for (const entry of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(DATA_DIR, entry.name);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const d = JSON.parse(readFileSync(resolve(dir, f), 'utf-8')) as Json;
      const porPos = new Map<number, string>();
      for (const s of d.sections) {
        for (const it of s.items) if (it.imageRef) porPos.set(it.position, it.imageRef);
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
    iguales = 0;
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
    for (const [pos, key] of porPos) {
      const fila = porPosicion.get(pos);
      if (!fila) {
        sinItem.push(`${source}#${pos}`);
        continue;
      }
      const actual = (fila.scoringConfig as Record<string, unknown> | null)?.imageRef;
      if (actual === key) {
        iguales++;
        continue;
      }
      await db
        .update(items)
        .set({
          scoringConfig: sql`coalesce(${items.scoringConfig}, '{}'::jsonb) || ${JSON.stringify({ imageRef: key })}::jsonb`,
        })
        .where(eq(items.id, fila.id));
      actualizados++;
    }
  }

  console.log(`imageRef: ${actualizados} actualizados, ${iguales} ya estaban al día.`);
  if (sinInstrumento.length)
    console.log(`  ⚠ sin instrumento en BDD: ${sinInstrumento.join(', ')}`);
  if (sinItem.length) console.log(`  ⚠ sin ítem en BDD: ${sinItem.join(', ')}`);
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  updatePaesImageRefs(createDbClient(url))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('ERROR:', e);
      process.exit(1);
    });
}
