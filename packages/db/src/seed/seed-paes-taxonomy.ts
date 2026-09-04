/**
 * Siembra el marco de taxonomía PAES (type=paes, version=2026) y sus nodos.
 *
 * ADITIVO e idempotente por `code`, igual que `add-taxonomy-nodes.ts` y por el mismo motivo:
 * `item_taxonomy_tags.node_id` tiene ON DELETE CASCADE, así que borrar y recrear nodos
 * BORRARÍA todos los tags de los ensayos ya cargados. Acá solo se insertan los códigos que
 * aún no existen.
 *
 * Fuente: `data/instruments-paes/paes-taxonomia-catalogo.json`, generado por
 * `ensayos-paes/taxonomia_paes.py` (que además documenta cada variante cruda observada en las
 * tablas de especificaciones).
 *
 * Uso: DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db exec tsx src/seed/seed-paes-taxonomy.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { taxonomies, taxonomyNodes } from '../schema/taxonomy';

type CatNode = {
  code: string;
  type: string;
  name: string;
  parentCode: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
};
type Catalog = {
  marcos: { paes: { name: string; type: 'paes'; version: string } };
  nodes: CatNode[];
};

const CATALOG = resolve(__dirname, '../../data/instruments-paes/paes-taxonomia-catalogo.json');

export async function seedPaesTaxonomy(db: Database): Promise<void> {
  const cat = JSON.parse(readFileSync(CATALOG, 'utf-8')) as Catalog;
  const marco = cat.marcos.paes;

  const byCode = new Map(cat.nodes.map((n) => [n.code, n]));
  for (const n of cat.nodes) {
    if (n.parentCode && !byCode.has(n.parentCode)) {
      throw new Error(`${n.code}: parent inexistente ${n.parentCode}`);
    }
  }

  let [tax] = await db
    .select({ id: taxonomies.id })
    .from(taxonomies)
    .where(and(eq(taxonomies.type, marco.type), eq(taxonomies.version, marco.version)));
  if (!tax) {
    [tax] = await db
      .insert(taxonomies)
      .values({
        name: marco.name,
        type: marco.type,
        version: marco.version,
        isOfficial: true,
        orgId: null,
      })
      .returning({ id: taxonomies.id });
    console.log(`marco creado: ${marco.name} (${marco.type}/${marco.version})`);
  }
  const taxonomyId = tax!.id;

  // Se insertan por niveles de profundidad para que el padre exista cuando se inserta el hijo.
  const depthOf = (code: string): number => {
    const n = byCode.get(code);
    return n?.parentCode ? depthOf(n.parentCode) + 1 : 0;
  };
  const ordenados = [...cat.nodes].sort((a, b) => depthOf(a.code) - depthOf(b.code));

  const idPorCode = new Map<string, string>(
    (
      await db
        .select({ id: taxonomyNodes.id, code: taxonomyNodes.code })
        .from(taxonomyNodes)
        .where(eq(taxonomyNodes.taxonomyId, taxonomyId))
    ).flatMap((r) => (r.code ? [[r.code, r.id] as [string, string]] : [])),
  );

  let creados = 0;
  for (const n of ordenados) {
    if (idPorCode.has(n.code)) continue;
    const [row] = await db
      .insert(taxonomyNodes)
      .values({
        taxonomyId,
        parentId: n.parentCode ? (idPorCode.get(n.parentCode) ?? null) : null,
        type: n.type as typeof taxonomyNodes.$inferInsert.type,
        code: n.code,
        name: n.name,
        depth: depthOf(n.code),
        metadata: { source: n.source ?? null, ...(n.metadata ?? {}) },
      })
      .onConflictDoNothing()
      .returning({ id: taxonomyNodes.id });
    if (row) {
      idPorCode.set(n.code, row.id);
      creados++;
    }
  }
  console.log(`PAES: ${creados} nodos creados, ${cat.nodes.length - creados} ya existían.`);
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  seedPaesTaxonomy(createDbClient(url))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('ERROR:', e);
      process.exit(1);
    });
}
