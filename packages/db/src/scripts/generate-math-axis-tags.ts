/**
 * Genera los tags de EJE TEMÁTICO para los ítems de Matemática en item-tags-plan.json.
 *
 * Por qué: el Gráfico 2 de los informes DIA de Matemática es por eje temático (Números y
 * operaciones, Geometría, Medición, Patrones y álgebra, Datos y probabilidades), pero los
 * ítems de Matemática solo están etiquetados por habilidad (Representar/Resolver) + OA +
 * descriptor. Sin el tag de eje, el gate #3 del importador de informes no encuentra el nodo
 * contra el cual cotejar el % reportado. Lectura no necesita esto: su eje ya ES la habilidad.
 *
 * Cómo (determinístico, sin BD, solo archivos del repo):
 *  - El eje (slug) sale del OA que el ítem ya trae: en el catálogo cada OA tiene `parentCode`
 *    = su nodo `axis` (p.ej. MATH-2B-OA05 → CUR-CONTENIDO-MATH-2B-AX-NUMEROS-Y-OPERACIONES).
 *  - El GRADO del nodo es el del INSTRUMENTO, no el del OA. Los informes de diagnóstico traen
 *    OAs de grados inferiores; si tomáramos el grado del OA, un instrumento recibiría dos nodos
 *    con el mismo nombre de eje y el gate #3 (que exige exactamente un nodo por nombre) fallaría.
 *    El eje temático es agnóstico al grado y el informe agrupa sobre los ítems del instrumento
 *    (un solo grado), así que el nodo correcto es el del grado del instrumento.
 *  - Idempotente: no duplica si el ítem ya tiene ese tag de eje.
 *
 * Re-ejecutable: reescribe item-tags-plan.json. Correr con:
 *   pnpm --filter @soe/db exec tsx src/scripts/generate-math-axis-tags.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PlanTag = { code: string; type: string; tagType: 'primary' | 'secondary' };
type PlanEntry = { instrument: string; position: number; tags: PlanTag[] };
type CatalogNode = { code: string; type: string; parentCode?: string | null };

const PLAN_PATH = resolve(__dirname, '../../data/instruments/item-tags-plan.json');
const CATALOG_PATH = resolve(__dirname, '../../data/taxonomia-catalogo-v2.json');

const AXIS_CODE_RE = /^CUR-CONTENIDO-MATH-\dB-AX-(.+)$/;
const OA_CODE_RE = /^MATH-\dB-OA\d+$/;

/** "extraccion/matematicas/4º matemáticas diagnóstico 2025.json" → "4B". */
function instrumentGrade(instrument: string): string | null {
  const m = instrument.match(/(\d+)º/);
  return m ? `${m[1]}B` : null;
}

function main(): void {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8')) as { nodes: CatalogNode[] };
  const nodes = catalog.nodes;

  // OA → slug del eje (desde el parentCode del OA en el catálogo).
  const oaEjeSlug = new Map<string, string>();
  for (const n of nodes) {
    if (!OA_CODE_RE.test(n.code) || !n.parentCode) continue;
    const m = n.parentCode.match(AXIS_CODE_RE);
    if (m) oaEjeSlug.set(n.code, m[1]!);
  }
  // Códigos de nodo `axis` que existen (para validar lo que construimos).
  const axisCodes = new Set(nodes.filter((n) => AXIS_CODE_RE.test(n.code)).map((n) => n.code));

  const doc = JSON.parse(readFileSync(PLAN_PATH, 'utf-8')) as { plan: PlanEntry[] };

  let added = 0;
  let alreadyTagged = 0;
  let mathItems = 0;
  const errors: string[] = [];

  for (const entry of doc.plan) {
    if (!entry.instrument.includes('matematicas')) continue;
    mathItems++;

    const grade = instrumentGrade(entry.instrument);
    if (!grade) {
      errors.push(`No pude derivar el grado del instrumento: ${entry.instrument}`);
      continue;
    }

    const loTags = entry.tags.filter((t) => t.type === 'learning_objective');
    if (loTags.length !== 1) {
      errors.push(`${entry.instrument} #${entry.position}: se esperaba 1 tag de OA, hay ${loTags.length}`);
      continue;
    }
    const oa = loTags[0]!.code;
    const slug = oaEjeSlug.get(oa);
    if (!slug) {
      errors.push(`${entry.instrument} #${entry.position}: OA ${oa} no tiene eje en el catálogo`);
      continue;
    }

    const axisCode = `CUR-CONTENIDO-MATH-${grade}-AX-${slug}`;
    if (!axisCodes.has(axisCode)) {
      errors.push(`${entry.instrument} #${entry.position}: nodo de eje inexistente ${axisCode}`);
      continue;
    }

    if (entry.tags.some((t) => t.code === axisCode)) {
      alreadyTagged++;
      continue;
    }

    // El campo `type` es documental (import-item-tags resuelve por `code`); usamos el tipo
    // real del nodo en el catálogo: `axis`. tagType 'secondary' como el OA/habilidad.
    entry.tags.push({ code: axisCode, type: 'axis', tagType: 'secondary' });
    added++;
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`  ✗ ${e}`);
    throw new Error(`${errors.length} error(es) generando tags de eje — no se escribió nada.`);
  }

  writeFileSync(PLAN_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  console.log(
    `Ítems de Matemática: ${mathItems}. Tags de eje agregados: ${added}, ya presentes: ${alreadyTagged}.`,
  );
  console.log('✅ item-tags-plan.json actualizado.');
}

main();
