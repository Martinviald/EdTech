/**
 * Actualiza `items.content` de instrumentos PAES ya cargados, con UPDATE **en sitio**.
 *
 * ⚠️ NO re-importar para corregir un ítem: `import-instruments.ts` borra y recrea el árbol del
 * instrumento y `item_taxonomy_tags.node_id` tiene ON DELETE CASCADE → se perderían los tags
 * ya aplicados. Este script toca sólo los ítems cuyo `content` difiere del JSON fuente.
 *
 * Acotado a propósito con ITEM_CONTENT_ONLY="<sourceJson>#<pos>,<sourceJson>#<pos>": sin esa
 * lista no escribe nada. Corregir un ítem no debe poder convertirse en una reescritura masiva
 * por descuido.
 *
 * Uso: DATABASE_ADMIN_URL=<url> ITEM_CONTENT_ONLY='M1-E3-con-pauta.json#32,…' \
 *      pnpm --filter @soe/db exec tsx src/seed/update-paes-item-content.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync, readdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { validateItemContent } from '@soe/types';
import { createDbClient, type Database } from '../client';
import { instruments } from '../schema/instruments';
import { items } from '../schema/items';

const DATA_DIR = resolve(__dirname, '../../data/instruments-paes');

type Alt = { key: string; text: string; isCorrect?: boolean; isImage?: boolean };
type It = { position: number; type: string; stem: string; alternatives?: Alt[] };

export async function updatePaesItemContent(db: Database): Promise<void> {
  const only = (process.env.ITEM_CONTENT_ONLY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!only.length)
    throw new Error('ITEM_CONTENT_ONLY es obligatorio (ej. "M1-E3-con-pauta.json#32")');
  const objetivo = new Set(only);

  const deseado = new Map<string, Map<number, It>>();
  for (const entry of readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(DATA_DIR, entry.name);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const d = JSON.parse(readFileSync(resolve(dir, f), 'utf-8')) as {
        sections: { items: It[] }[];
      };
      const porPos = new Map<number, It>();
      for (const s of d.sections) for (const it of s.items) porPos.set(it.position, it);
      deseado.set(f, porPos);
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

  let escritos = 0;
  for (const clave of objetivo) {
    const [source, posStr] = clave.split('#');
    const pos = Number(posStr);
    const it = deseado.get(source!)?.get(pos);
    const instId = porSource.get(source!);
    if (!it || !instId) {
      console.log(`  ⚠ no resuelto: ${clave}`);
      continue;
    }
    const content = validateItemContent(it.type as Parameters<typeof validateItemContent>[0], {
      stem: it.stem,
      alternatives: (it.alternatives ?? []).map((a) => ({
        key: a.key,
        text: a.text,
        isCorrect: Boolean(a.isCorrect),
      })),
    });
    const filas = await db
      .select({ id: items.id, position: items.position })
      .from(items)
      .where(eq(items.instrumentId, instId));
    const fila = filas.find((f) => f.position === pos);
    if (!fila) {
      console.log(`  ⚠ sin ítem en BDD: ${clave}`);
      continue;
    }
    await db.update(items).set({ content }).where(eq(items.id, fila.id));
    escritos++;
    console.log(`  ✓ ${clave}: ${(it.alternatives ?? []).length} alternativas`);
  }
  console.log(`content actualizado en ${escritos}/${objetivo.size} ítems.`);
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  updatePaesItemContent(createDbClient(url))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('ERROR:', e);
      process.exit(1);
    });
}
