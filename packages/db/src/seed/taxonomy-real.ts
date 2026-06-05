/**
 * Loader idempotente de la taxonomía REAL (reference-data, replicable en producción).
 *
 * Siembra `taxonomy_nodes` desde `data/taxonomia-catalogo.json`:
 *   - axis (eje) + learning_objective (OA): oficiales MINEDUC (curriculumnacional.cl).
 *   - descriptor (indicador), skill (eje de habilidad), text_type (tipo de texto): DIA.
 * Todo en UNA taxonomía ("DIA 2025"), árbol conexo (descriptor→OA→eje). `metadata.source`
 * distingue mineduc/dia. Reemplaza la taxonomía generada por IA (limpia los nodos previos).
 *
 * NO depende de ítems (se corre ANTES del import de instrumentos). Los `item_taxonomy_tags`
 * se aplican aparte, después del import.
 *
 * Uso (local o PRODUCCIÓN):
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:seed:taxonomy
 * Idempotente: re-ejecutar deja el mismo estado.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { readFileSync } from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient } from '../client';
import { taxonomies, taxonomyNodes } from '../schema/taxonomy';
import { grades, subjects } from '../schema/academic';

type CatalogNode = {
  code: string;
  type: 'axis' | 'learning_objective' | 'descriptor' | 'skill' | 'text_type';
  name: string;
  parentCode: string | null;
  subjectCode: 'LANG' | 'MATH';
  level?: string;
  oaNumber?: number;
  shortName?: string;
  source: 'mineduc' | 'dia';
  order: number;
};

const TAXONOMY = { type: 'dia' as const, version: '2025', name: 'DIA 2025' };
const DEPTH: Record<CatalogNode['type'], number> = {
  axis: 0, skill: 0, text_type: 0, learning_objective: 1, descriptor: 2,
};
// Pasadas en orden topológico (padre antes que hijo).
const PASSES: CatalogNode['type'][][] = [
  ['axis', 'skill', 'text_type'],
  ['learning_objective'],
  ['descriptor'],
];

function levelToShortName(level?: string): string | null {
  if (!level) return null;
  const num = level.split('_')[0];
  return /^[1-6]$/.test(num) ? `${num}B` : null; // 2_basico -> 2B
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const db = createDbClient(databaseUrl);

  const catalogPath = resolve(__dirname, '../../data/taxonomia-catalogo.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as { nodes: CatalogNode[] };
  const nodes = catalog.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error('Catálogo vacío o inválido');

  // Validación básica de integridad (falla temprano).
  const byCode = new Map(nodes.map((n) => [n.code, n]));
  for (const n of nodes) {
    if (!n.code || !n.type || !n.name) throw new Error(`Nodo inválido: ${JSON.stringify(n)}`);
    if (n.parentCode && !byCode.has(n.parentCode)) {
      throw new Error(`Nodo ${n.code}: parentCode inexistente ${n.parentCode}`);
    }
  }

  const subjRows = await db.select({ id: subjects.id, code: subjects.code }).from(subjects);
  const gradeRows = await db.select({ id: grades.id, shortName: grades.shortName }).from(grades);
  const subjectIdByCode = new Map(subjRows.map((s) => [s.code, s.id]));
  const gradeIdByShort = new Map(gradeRows.map((g) => [g.shortName, g.id]));

  await db.transaction(async (tx) => {
    // 1) Asegurar la fila de taxonomía (upsert por type+version).
    let [tax] = await tx
      .select({ id: taxonomies.id })
      .from(taxonomies)
      .where(eq(taxonomies.version, TAXONOMY.version));
    let taxId: string;
    if (!tax) {
      const [ins] = await tx
        .insert(taxonomies)
        .values({ name: TAXONOMY.name, type: TAXONOMY.type, version: TAXONOMY.version, isOfficial: true })
        .returning({ id: taxonomies.id });
      taxId = ins.id;
    } else {
      taxId = tax.id;
    }

    // 2) Limpiar la taxonomía IA: borrar nodos de TODA taxonomía oficial existente
    //    (MINEDUC 2024 + DIA 2025). El cascade elimina item_taxonomy_tags demo asociados.
    const officialTax = await tx.select({ id: taxonomies.id }).from(taxonomies).where(eq(taxonomies.isOfficial, true));
    const ids = officialTax.map((t) => t.id);
    if (ids.length) await tx.delete(taxonomyNodes).where(inArray(taxonomyNodes.taxonomyId, ids));

    // 3) Insertar nodos reales en orden topológico, todo en la taxonomía única.
    const idByCode = new Map<string, string>();
    const subjByCode = new Map<string, string | null>();
    const gradeByCode = new Map<string, string | null>();
    let inserted = 0;
    for (const pass of PASSES) {
      const batch = nodes.filter((n) => pass.includes(n.type));
      for (const n of batch) {
        const subjectId = subjectIdByCode.get(n.subjectCode) ?? null;
        let gradeId: string | null = null;
        if (n.type === 'learning_objective') {
          gradeId = gradeIdByShort.get(levelToShortName(n.level) ?? '') ?? null;
        } else if (n.type === 'descriptor' && n.parentCode) {
          gradeId = gradeByCode.get(n.parentCode) ?? null; // hereda del OA padre
        }
        const [row] = await tx
          .insert(taxonomyNodes)
          .values({
            taxonomyId: taxId,
            parentId: n.parentCode ? idByCode.get(n.parentCode) ?? null : null,
            type: n.type,
            code: n.code,
            name: n.name,
            subjectId,
            gradeId,
            order: n.order ?? 0,
            depth: DEPTH[n.type],
            metadata: {
              source: n.source,
              ...(n.shortName ? { shortName: n.shortName } : {}),
              ...(n.level ? { level: n.level } : {}),
              ...(n.oaNumber ? { oaNumber: n.oaNumber } : {}),
            },
          })
          .returning({ id: taxonomyNodes.id });
        idByCode.set(n.code, row.id);
        subjByCode.set(n.code, subjectId);
        gradeByCode.set(n.code, gradeId);
        inserted++;
      }
    }

    // 4) Resumen
    const counts: Record<string, number> = {};
    for (const n of nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;
    console.log(`Taxonomía "${TAXONOMY.name}" (${taxId}) — nodos insertados: ${inserted}`);
    console.log('  por tipo:', JSON.stringify(counts));
  });

  console.log('✅ Taxonomía real sembrada (idempotente).');
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR sembrando taxonomía:', e);
  process.exit(1);
});
