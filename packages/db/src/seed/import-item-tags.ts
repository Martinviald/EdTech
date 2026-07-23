/**
 * Aplica item_taxonomy_tags desde item-tags-plan.json (Parte B del import).
 * Idempotente: borra los tags de los ítems resueltos y reinserta los del plan.
 * Requiere instrumentos ya importados (db:import:instruments) y la taxonomía sembrada.
 * Replicable en prod: DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:import:item-tags
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync } from 'node:fs';
import { inArray } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { instruments } from '../schema/instruments';
import { items, itemTaxonomyTags } from '../schema/items';
import { taxonomyNodes } from '../schema/taxonomy';

type PlanTag = { code: string; type: string; tagType: 'primary' | 'secondary' };
type PlanEntry = { instrument: string; position: number; tags: PlanTag[] };

export async function applyItemTags(db: Database): Promise<void> {
  // Override opcional (ITEM_TAGS_PLAN) para cargar un plan aislado (ej. la tanda DIA 2026)
  // sin fusionar con el plan 2025.
  const planPath = process.env.ITEM_TAGS_PLAN
    ? resolve(process.env.ITEM_TAGS_PLAN)
    : resolve(__dirname, '../../data/instruments/item-tags-plan.json');
  const plan = (JSON.parse(readFileSync(planPath, 'utf-8')) as { plan: PlanEntry[] }).plan;

  // Mapas de resolución
  const instRows = await db.select({ id: instruments.id, config: instruments.config }).from(instruments);
  const instBySource = new Map<string, string>();
  for (const r of instRows) {
    const src = (r.config as { sourceJson?: string } | null)?.sourceJson;
    if (src) instBySource.set(src, r.id);
  }
  const itemRows = await db
    .select({ id: items.id, instrumentId: items.instrumentId, position: items.position })
    .from(items);
  const itemByKey = new Map<string, string>();
  for (const r of itemRows) if (r.instrumentId) itemByKey.set(`${r.instrumentId}:${r.position}`, r.id);
  const nodeRows = await db.select({ id: taxonomyNodes.id, code: taxonomyNodes.code }).from(taxonomyNodes);
  const nodeByCode = new Map<string, string>();
  for (const n of nodeRows) if (n.code) nodeByCode.set(n.code, n.id);

  // Resolver
  const resolvedItemIds = new Set<string>();
  const toInsert: { itemId: string; nodeId: string; tagType: 'primary' | 'secondary' }[] = [];
  const noInstrument = new Set<string>();
  let noItem = 0;
  const noCode = new Set<string>();

  for (const e of plan) {
    const instId = instBySource.get(e.instrument);
    if (!instId) { noInstrument.add(e.instrument); continue; }
    const itemId = itemByKey.get(`${instId}:${e.position}`);
    if (!itemId) { noItem++; continue; }
    resolvedItemIds.add(itemId);
    for (const t of e.tags) {
      const nodeId = nodeByCode.get(t.code);
      if (!nodeId) { noCode.add(t.code); continue; }
      toInsert.push({ itemId, nodeId, tagType: t.tagType });
    }
  }

  await db.transaction(async (tx) => {
    const ids = [...resolvedItemIds];
    // idempotencia: limpiar tags de los ítems resueltos y reinsertar
    for (let i = 0; i < ids.length; i += 500) {
      await tx.delete(itemTaxonomyTags).where(inArray(itemTaxonomyTags.itemId, ids.slice(i, i + 500)));
    }
    for (let i = 0; i < toInsert.length; i += 500) {
      await tx
        .insert(itemTaxonomyTags)
        .values(
          toInsert.slice(i, i + 500).map((t) => ({
            itemId: t.itemId, nodeId: t.nodeId, tagType: t.tagType,
            taggedBy: 'human' as const, confidence: '1.00',
          })),
        )
        .onConflictDoNothing();
    }
  });

  console.log(`Tags: ${toInsert.length} insertados sobre ${resolvedItemIds.size} ítems.`);
  if (noInstrument.size) console.log(`  instrumentos del plan no importados (${noInstrument.size}): ${[...noInstrument].slice(0, 5).join(', ')}…`);
  if (noItem) console.log(`  ⚠️ ${noItem} (instrumento, position) sin ítem en BDD`);
  if (noCode.size) console.log(`  ⚠️ codes sin nodo (${noCode.size}): ${[...noCode].slice(0, 10).join(', ')}`);
  else console.log('  Todos los codes resolvieron a un nodo ✅');
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  applyItemTags(createDbClient(url))
    .then(() => { console.log('✅ Tags aplicados.'); process.exit(0); })
    .catch((e) => { console.error('ERROR aplicando tags:', e); process.exit(1); });
}
