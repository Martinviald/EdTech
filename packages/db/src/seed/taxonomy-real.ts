/**
 * Loader idempotente de la taxonomía REAL en 2 MARCOS (reference-data, replicable en producción).
 *
 *   MARCO "Currículum Nacional" (type mineduc) — universal:
 *     Contenido:  Asignatura → Grado → Eje → OA
 *     Habilidades: Asignatura → Habilidad
 *     Tipos de texto: Asignatura → Tipo de texto
 *   MARCO "DIA" (type dia) — estable (el año vive en instruments.year):
 *     Asignatura → Nivel → Indicador   (+ taxonomy_mappings indicador→OA [subset] / →habilidad [related])
 *
 * Lee `data/taxonomia-catalogo-v2.json`. NO borra las taxonomías viejas (coexisten para auditar).
 * Idempotente: borra los nodos de las 2 taxonomías nuevas y los recrea.
 *
 * Uso (local o PRODUCCIÓN): DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:seed:taxonomy
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
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
  const n = (level ?? '').split('_')[0] ?? '';
  return /^[1-8]$/.test(n) ? `${n}B` : null;
}

export async function seedTaxonomyReal(db: Database): Promise<void> {
  const cat = JSON.parse(
    readFileSync(resolve(__dirname, '../../data/taxonomia-catalogo-v2.json'), 'utf-8'),
  ) as Catalog;

  // validación básica
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
    // 1) Asegurar las 2 taxonomías (upsert por type+version) y recolectar ids.
    const marcoTaxId: Record<Marco, string> = { curriculum: '', dia: '' };
    for (const marco of ['curriculum', 'dia'] as Marco[]) {
      const meta = cat.marcos[marco];
      const [row] = await tx
        .select({ id: taxonomies.id })
        .from(taxonomies)
        .where(and(eq(taxonomies.type, meta.type), eq(taxonomies.version, meta.version)));
      if (row) {
        marcoTaxId[marco] = row.id;
      } else {
        const [ins] = await tx
          .insert(taxonomies)
          .values({ name: meta.name, type: meta.type, version: meta.version, isOfficial: true })
          .returning({ id: taxonomies.id });
        marcoTaxId[marco] = ins!.id;
      }
    }

    // 2) Limpiar SOLO las 2 taxonomías nuevas (idempotencia). NO toca las viejas.
    await tx.delete(taxonomyNodes).where(inArray(taxonomyNodes.taxonomyId, [marcoTaxId.curriculum, marcoTaxId.dia]));

    // 3) Insertar nodos en orden topológico (padre antes que hijo).
    const idByCode = new Map<string, string>();
    const depthByCode = new Map<string, number>();
    let pending = [...cat.nodes];
    while (pending.length) {
      const ready = pending.filter((n) => !n.parentCode || idByCode.has(n.parentCode));
      if (ready.length === 0) throw new Error('Ciclo o padre faltante en el catálogo');
      for (const n of ready) {
        const depth = n.parentCode ? (depthByCode.get(n.parentCode) ?? 0) + 1 : 0;
        const [row] = await tx
          .insert(taxonomyNodes)
          .values({
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
          })
          .returning({ id: taxonomyNodes.id });
        idByCode.set(n.code, row!.id);
        depthByCode.set(n.code, depth);
      }
      pending = pending.filter((n) => !idByCode.has(n.code));
    }

    // 4) Insertar mappings (indicador→OA / indicador→habilidad).
    for (const m of cat.mappings) {
      await tx.insert(taxonomyMappings).values({
        sourceNodeId: idByCode.get(m.sourceCode)!,
        targetNodeId: idByCode.get(m.targetCode)!,
        mappingType: m.mappingType as typeof taxonomyMappings.$inferInsert.mappingType,
      });
    }

    const byMarco = (mc: Marco) => cat.nodes.filter((n) => n.marco === mc).length;
    console.log(`Currículum Nacional (${marcoTaxId.curriculum}): ${byMarco('curriculum')} nodos`);
    console.log(`DIA (${marcoTaxId.dia}): ${byMarco('dia')} nodos`);
    console.log(`taxonomy_mappings: ${cat.mappings.length}`);
  });

  console.log('✅ Taxonomía real (2 marcos) sembrada.');
}

// CLI: `pnpm --filter @soe/db db:seed:taxonomy` (reference-data, replicable en prod).
if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  seedTaxonomyReal(createDbClient(url))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('ERROR sembrando taxonomía:', e);
      process.exit(1);
    });
}
