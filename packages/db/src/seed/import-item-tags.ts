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
import {
  indexItemsForTagPlan,
  resolveTagPlanTarget,
  type TagPlanIndex,
  type TagPlanItem,
} from '@soe/types';
import { createDbClient, type Database } from '../client';
import { instruments } from '../schema/instruments';
import { items, itemTaxonomyTags } from '../schema/items';
import { taxonomyNodes } from '../schema/taxonomy';

type PlanTag = { code: string; type: string; tagType: 'primary' | 'secondary' };
/**
 * Una entrada del plan. `printedNumber` es OPCIONAL y es la clave preferente: apunta al
 * número impreso en el cuadernillo, que sobrevive a una renumeración de `position`
 * (fusionar instrumentos, recortar secciones). Los planes que no lo traen se resuelven
 * por `position` exactamente como antes — ver `item-tag-plan-resolver.ts`.
 */
type PlanEntry = {
  instrument: string;
  position: number;
  printedNumber?: string | null;
  tags: PlanTag[];
};

export async function applyItemTags(db: Database): Promise<void> {
  // Override opcional (ITEM_TAGS_PLAN) para cargar un plan aislado (ej. la tanda DIA 2026)
  // sin fusionar con el plan 2025.
  const planPath = process.env.ITEM_TAGS_PLAN
    ? resolve(process.env.ITEM_TAGS_PLAN)
    : resolve(__dirname, '../../data/instruments/item-tags-plan.json');
  const plan = (JSON.parse(readFileSync(planPath, 'utf-8')) as { plan: PlanEntry[] }).plan;

  // Mapas de resolución
  const instRows = await db
    .select({ id: instruments.id, config: instruments.config })
    .from(instruments);
  const instBySource = new Map<string, string>();
  for (const r of instRows) {
    const src = (r.config as { sourceJson?: string } | null)?.sourceJson;
    if (src) instBySource.set(src, r.id);
  }
  const itemRows = await db
    .select({
      id: items.id,
      instrumentId: items.instrumentId,
      position: items.position,
      scoringConfig: items.scoringConfig,
    })
    .from(items);
  // Un índice por instrumento: (número impreso → ítem) y (posición → ítem).
  const itemsByInstrument = new Map<string, TagPlanItem[]>();
  for (const r of itemRows) {
    if (!r.instrumentId) continue;
    const printed = (r.scoringConfig as { printedNumber?: string | null } | null)?.printedNumber;
    const list = itemsByInstrument.get(r.instrumentId);
    const entry: TagPlanItem = { id: r.id, position: r.position, printedNumber: printed ?? null };
    if (list) list.push(entry);
    else itemsByInstrument.set(r.instrumentId, [entry]);
  }
  const indexByInstrument = new Map<string, TagPlanIndex>();
  for (const [instId, list] of itemsByInstrument) {
    indexByInstrument.set(instId, indexItemsForTagPlan(list));
  }
  const nodeRows = await db
    .select({ id: taxonomyNodes.id, code: taxonomyNodes.code })
    .from(taxonomyNodes);
  const nodeByCode = new Map<string, string>();
  for (const n of nodeRows) if (n.code) nodeByCode.set(n.code, n.id);

  // Resolver
  const resolvedItemIds = new Set<string>();
  const toInsert: { itemId: string; nodeId: string; tagType: 'primary' | 'secondary' }[] = [];
  const noInstrument = new Set<string>();
  let noItem = 0;
  let noItemByPrinted = 0;
  let viaPrinted = 0;
  let viaPosition = 0;
  const mismatchByInstrument = new Map<string, number>();
  const ambiguousInstruments = new Set<string>();
  const noCode = new Set<string>();

  for (const e of plan) {
    const instId = instBySource.get(e.instrument);
    if (!instId) {
      noInstrument.add(e.instrument);
      continue;
    }
    const index = indexByInstrument.get(instId);
    if (!index) {
      noItem++;
      continue;
    }
    if (index.ambiguousPrinted.size > 0) ambiguousInstruments.add(e.instrument);
    const match = resolveTagPlanTarget(index, e);
    if (!match.itemId) {
      // Distinguimos las dos vías: una entrada con `printedNumber` que no resuelve NO
      // cae a `position` a propósito (caer sería el mis-tagging que esto vino a matar).
      if (e.printedNumber != null && e.printedNumber !== '') noItemByPrinted++;
      else noItem++;
      continue;
    }
    if (match.via === 'printedNumber') viaPrinted++;
    else viaPosition++;
    if (match.printedMismatch) {
      mismatchByInstrument.set(e.instrument, (mismatchByInstrument.get(e.instrument) ?? 0) + 1);
    }
    const itemId = match.itemId;
    resolvedItemIds.add(itemId);
    for (const t of e.tags) {
      const nodeId = nodeByCode.get(t.code);
      if (!nodeId) {
        noCode.add(t.code);
        continue;
      }
      toInsert.push({ itemId, nodeId, tagType: t.tagType });
    }
  }

  await db.transaction(async (tx) => {
    const ids = [...resolvedItemIds];
    // idempotencia: limpiar tags de los ítems resueltos y reinsertar
    for (let i = 0; i < ids.length; i += 500) {
      await tx
        .delete(itemTaxonomyTags)
        .where(inArray(itemTaxonomyTags.itemId, ids.slice(i, i + 500)));
    }
    for (let i = 0; i < toInsert.length; i += 500) {
      await tx
        .insert(itemTaxonomyTags)
        .values(
          toInsert.slice(i, i + 500).map((t) => ({
            itemId: t.itemId,
            nodeId: t.nodeId,
            tagType: t.tagType,
            taggedBy: 'human' as const,
            confidence: '1.00',
          })),
        )
        .onConflictDoNothing();
    }
  });

  console.log(`Tags: ${toInsert.length} insertados sobre ${resolvedItemIds.size} ítems.`);
  console.log(`  resueltos por número impreso: ${viaPrinted} · por posición: ${viaPosition}`);
  if (noInstrument.size)
    console.log(
      `  instrumentos del plan no importados (${noInstrument.size}): ${[...noInstrument].slice(0, 5).join(', ')}…`,
    );
  if (noItem) console.log(`  ⚠️ ${noItem} (instrumento, position) sin ítem en BDD`);
  if (noItemByPrinted)
    console.log(
      `  ⚠️ ${noItemByPrinted} (instrumento, printedNumber) sin ítem en BDD — NO se cae a position a propósito`,
    );
  if (ambiguousInstruments.size)
    console.log(
      `  ⚠️ instrumentos con números impresos repetidos (${ambiguousInstruments.size}): ${[...ambiguousInstruments].slice(0, 5).join(', ')} — ahí printedNumber no sirve de clave`,
    );
  if (mismatchByInstrument.size) {
    const total = [...mismatchByInstrument.values()].reduce((a, b) => a + b, 0);
    console.log(
      `  ⚠️ ${total} entradas se resolvieron por POSICIÓN sobre ítems cuyo número impreso es distinto,`,
    );
    console.log(
      '     en ' +
        mismatchByInstrument.size +
        ' instrumento(s): ' +
        [...mismatchByInstrument.keys()].slice(0, 5).join(', '),
    );
    console.log('     Regenera esos planes con `printedNumber` antes de renumerar el instrumento.');
  }
  if (noCode.size)
    console.log(`  ⚠️ codes sin nodo (${noCode.size}): ${[...noCode].slice(0, 10).join(', ')}`);
  else console.log('  Todos los codes resolvieron a un nodo ✅');
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  applyItemTags(createDbClient(url))
    .then(() => {
      console.log('✅ Tags aplicados.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('ERROR aplicando tags:', e);
      process.exit(1);
    });
}
