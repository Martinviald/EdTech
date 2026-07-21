/**
 * Inserter ADITIVO de taxonomy_nodes (idempotente por code). NUNCA borra.
 *
 * ⚠️ Existe porque `taxonomy-real.ts` (db:seed:taxonomy) hace delete+recreate de TODOS los nodos
 * de los 2 marcos → regenera sus UUID → como `item_taxonomy_tags.node_id` tiene ON DELETE CASCADE,
 * ese seed BORRA todos los tags. Este script sólo INSERTA los códigos del catálogo que aún NO
 * existen en la BDD (ON CONFLICT (taxonomy_id, code) DO NOTHING), preservando los UUID vigentes y,
 * por lo tanto, todos los item_taxonomy_tags. Úsalo para extender la taxonomía (ej. OA de grados
 * altos, Tier 2 Pieza B) sin orfanar tags.
 *
 * Requiere que las 2 taxonomías (mineduc/2023, dia/vigente) YA existan (las crea db:seed:taxonomy
 * la primera vez). Lee `data/taxonomia-catalogo-v2.json` (misma fuente que el seed completo).
 *
 * Uso: DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db exec tsx src/seed/add-taxonomy-nodes.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { taxonomies, taxonomyNodes, taxonomyMappings } from '../schema/taxonomy';
import { grades, subjects } from '../schema/academic';

type Marco = 'curriculum' | 'dia';
type CatNode = {
  code: string; type: string; name: string; parentCode: string | null;
  marco: Marco; subjectCode: 'LANG' | 'MATH' | null;
  level?: string; oaNumber?: number; shortName?: string; source: string; order?: number;
};
type Mapping = { sourceCode: string; targetCode: string; mappingType: string };
type Catalog = {
  marcos: Record<Marco, { name: string; type: 'mineduc' | 'dia'; version: string }>;
  nodes: CatNode[]; mappings: Mapping[];
};

function gradeShort(level?: string): string | null {
  // "6_basico"→"6B", "1_medio"→"1M". NUNCA mapear medio a básico (grades tiene filas 1M–4M).
  const [num, tier] = (level ?? '').split('_');
  if (/^[1-8]$/.test(num ?? '') && tier === 'basico') return `${num}B`;
  if (/^[1-4]$/.test(num ?? '') && tier === 'medio') return `${num}M`;
  return null;
}

export async function addTaxonomyNodes(db: Database): Promise<void> {
  const cat = JSON.parse(
    readFileSync(resolve(__dirname, '../../data/taxonomia-catalogo-v2.json'), 'utf-8'),
  ) as Catalog;

  // Validación de integridad del catálogo (padres y mappings presentes).
  const byCode = new Map(cat.nodes.map((n) => [n.code, n]));
  for (const n of cat.nodes) {
    if (n.parentCode && !byCode.has(n.parentCode)) throw new Error(`${n.code}: parent inexistente ${n.parentCode}`);
  }
  for (const m of cat.mappings) {
    if (!byCode.has(m.sourceCode) || !byCode.has(m.targetCode)) throw new Error(`mapping inválido ${m.sourceCode}->${m.targetCode}`);
  }

  const subjRows = await db.select({ id: subjects.id, code: subjects.code }).from(subjects);
  const gradeRows = await db.select({ id: grades.id, shortName: grades.shortName }).from(grades);
  const subjId = new Map(subjRows.map((s) => [s.code, s.id]));
  const gradeId = new Map(gradeRows.map((g) => [g.shortName, g.id]));

  await db.transaction(async (tx) => {
    // Resolver taxonomyId de cada marco (deben existir; NO se crean aquí).
    const marcoTaxId: Record<Marco, string> = { curriculum: '', dia: '' };
    for (const marco of ['curriculum', 'dia'] as Marco[]) {
      const meta = cat.marcos[marco];
      const [row] = await tx
        .select({ id: taxonomies.id })
        .from(taxonomies)
        .where(and(eq(taxonomies.type, meta.type), eq(taxonomies.version, meta.version)));
      if (!row) throw new Error(`Taxonomía ${meta.type}/${meta.version} no existe; corre db:seed:taxonomy primero.`);
      marcoTaxId[marco] = row.id;
    }

    // Mapa code→id de TODOS los nodos existentes (para no reinsertar y para resolver padres).
    const idByCode = new Map<string, string>();
    const depthByCode = new Map<string, number>();
    const existing = await tx
      .select({ id: taxonomyNodes.id, code: taxonomyNodes.code, depth: taxonomyNodes.depth })
      .from(taxonomyNodes);
    for (const r of existing) {
      if (r.code) { idByCode.set(r.code, r.id); depthByCode.set(r.code, r.depth ?? 0); }
    }
    const preexisting = new Set(idByCode.keys());

    // Insertar en orden topológico SÓLO los códigos faltantes (padre antes que hijo). Se BATCHEA
    // por ola (un multi-row insert por nivel de profundidad) para minimizar round-trips por el túnel.
    let inserted = 0;
    let pending = cat.nodes.filter((n) => !preexisting.has(n.code));
    while (pending.length) {
      const ready = pending.filter((n) => !n.parentCode || idByCode.has(n.parentCode));
      if (ready.length === 0) throw new Error(`Ciclo o padre faltante: ${pending.slice(0, 5).map((n) => n.code).join(', ')}`);
      const values = ready.map((n) => {
        const depth = n.parentCode ? (depthByCode.get(n.parentCode) ?? 0) + 1 : 0;
        depthByCode.set(n.code, depth);
        return {
          taxonomyId: marcoTaxId[n.marco],
          parentId: n.parentCode ? idByCode.get(n.parentCode)! : null,
          type: n.type as typeof taxonomyNodes.$inferInsert.type,
          code: n.code,
          name: n.name,
          subjectId: n.subjectCode ? subjId.get(n.subjectCode) ?? null : null,
          gradeId: n.level ? gradeId.get(gradeShort(n.level) ?? '') ?? null : null,
          order: n.order ?? 0,
          depth,
          metadata: {
            source: n.source, marco: n.marco,
            ...(n.level ? { level: n.level } : {}),
            ...(n.oaNumber ? { oaNumber: n.oaNumber } : {}),
            ...(n.shortName ? { shortName: n.shortName } : {}),
          },
        };
      });
      const rows = await tx.insert(taxonomyNodes).values(values).onConflictDoNothing()
        .returning({ id: taxonomyNodes.id, code: taxonomyNodes.code });
      const idByRet = new Map(rows.map((r) => [r.code!, r.id]));
      inserted += rows.length;
      // Fallback por si algún code entró en conflicto (carrera): resolver los faltantes.
      for (const n of ready) {
        let id = idByRet.get(n.code);
        if (!id) {
          const [ex] = await tx.select({ id: taxonomyNodes.id }).from(taxonomyNodes)
            .where(and(eq(taxonomyNodes.taxonomyId, marcoTaxId[n.marco]), eq(taxonomyNodes.code, n.code)));
          id = ex!.id;
        }
        idByCode.set(n.code, id);
      }
      pending = pending.filter((n) => !idByCode.has(n.code));
    }

    // Mappings: cargar los pares existentes de una vez y batchear sólo los que falten.
    const existingMaps = await tx
      .select({ s: taxonomyMappings.sourceNodeId, t: taxonomyMappings.targetNodeId })
      .from(taxonomyMappings);
    const mapSet = new Set(existingMaps.map((m) => `${m.s}:${m.t}`));
    const newMapValues = cat.mappings
      .map((m) => ({ s: idByCode.get(m.sourceCode)!, t: idByCode.get(m.targetCode)!, mt: m.mappingType }))
      .filter((m) => m.s && m.t && !mapSet.has(`${m.s}:${m.t}`));
    let newMappings = 0;
    if (newMapValues.length) {
      await tx.insert(taxonomyMappings).values(
        newMapValues.map((m) => ({
          sourceNodeId: m.s, targetNodeId: m.t,
          mappingType: m.mt as typeof taxonomyMappings.$inferInsert.mappingType,
        })),
      ).onConflictDoNothing();
      newMappings = newMapValues.length;
    }

    console.log(`Nodos nuevos insertados: ${inserted} (catálogo: ${cat.nodes.length}, preexistentes: ${preexisting.size})`);
    console.log(`Mappings nuevos: ${newMappings}`);
  });

  console.log('✅ Inserción aditiva completa (sin borrar; tags preservados).');
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  addTaxonomyNodes(createDbClient(url))
    .then(() => process.exit(0))
    .catch((e) => { console.error('ERROR:', e); process.exit(1); });
}
