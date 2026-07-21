import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { assessmentItemStats, itemTaxonomyTags, items, taxonomyNodes } from '@soe/db';
import { mergeAnswerCounts, type AnswerCount } from '@soe/types';
import type { Database } from '../../database/database.types';

// Carga de datos por ítem para la tabla de especificaciones (TKT-24) y el detalle
// por pregunta del informe por alumno (TKT-26). Las columnas taxonómicas se
// derivan por el `type` del taxonomy_node — sin hardcodear ningún instrumento.

interface ItemAlternativeRaw {
  key?: unknown;
  text?: unknown;
  isCorrect?: unknown;
}
interface ItemContentRaw {
  alternatives?: unknown;
  correctKey?: unknown;
}

export type ItemAlternativeDef = { key: string; text: string | null; isCorrect: boolean };

export type ItemReportColumn = {
  itemId: string;
  position: number;
  itemType: string;
  correctKey: string | null;
  alternatives: ItemAlternativeDef[];
  hasAlternatives: boolean;
  // Columnas taxonómicas (cualquiera puede ser null).
  oaCode: string | null;
  oaName: string | null;
  textType: string | null;
  axis: string | null;
  skill: string | null;
  indicator: string | null;
};

export type ItemAnswerDistribution = {
  totalResponses: number;
  answeredCount: number;
  correctCount: number;
  byAnswer: Map<string, number>; // key → nº que la eligió
};

export type DevelopmentDistribution = { rc: number; rpc: number; ri: number; n: number };

// Mapeo de tipos de nodo a columnas de la tabla de especificaciones.
const OA_NODE_TYPES = ['learning_objective'];
const TEXT_TYPE_NODE_TYPES = ['text_type'];
const AXIS_NODE_TYPES = ['axis'];
const SKILL_NODE_TYPES = ['skill'];
const INDICATOR_NODE_TYPES = ['descriptor', 'criterion'];

/** Ítems del instrumento con sus columnas taxonómicas y alternativas. */
export async function loadItemColumns(
  tx: Database,
  instrumentId: string,
): Promise<ItemReportColumn[]> {
  const rows = await tx
    .select({
      itemId: items.id,
      position: items.position,
      type: sql<string>`${items.type}::text`,
      content: items.content,
    })
    .from(items)
    .where(and(eq(items.instrumentId, instrumentId), isNull(items.deletedAt)))
    .orderBy(asc(items.position));

  const itemIds = rows.map((r) => r.itemId);
  const tagsByItem = await loadTagColumns(tx, itemIds);

  return rows.map((r) => {
    const content = (r.content ?? {}) as ItemContentRaw;
    const alternatives = parseAlternatives(content);
    const cols = tagsByItem.get(r.itemId) ?? emptyTagColumns();
    return {
      itemId: r.itemId,
      position: r.position,
      itemType: r.type,
      correctKey: deriveCorrectKey(content, alternatives),
      alternatives,
      hasAlternatives: alternatives.length > 0,
      ...cols,
    };
  });
}

type TagColumns = {
  oaCode: string | null;
  oaName: string | null;
  textType: string | null;
  axis: string | null;
  skill: string | null;
  indicator: string | null;
};

function emptyTagColumns(): TagColumns {
  return {
    oaCode: null,
    oaName: null,
    textType: null,
    axis: null,
    skill: null,
    indicator: null,
  };
}

async function loadTagColumns(tx: Database, itemIds: string[]): Promise<Map<string, TagColumns>> {
  const map = new Map<string, TagColumns>();
  if (itemIds.length === 0) return map;

  const rows = await tx
    .select({
      itemId: itemTaxonomyTags.itemId,
      nodeName: taxonomyNodes.name,
      nodeCode: taxonomyNodes.code,
      nodeType: sql<string>`${taxonomyNodes.type}::text`,
      tagType: sql<string>`${itemTaxonomyTags.tagType}::text`,
    })
    .from(itemTaxonomyTags)
    .innerJoin(taxonomyNodes, eq(taxonomyNodes.id, itemTaxonomyTags.nodeId))
    .where(inArray(itemTaxonomyTags.itemId, itemIds))
    // primary antes que secondary: el primer nodo de cada tipo gana.
    .orderBy(asc(itemTaxonomyTags.tagType));

  for (const r of rows) {
    let entry = map.get(r.itemId);
    if (!entry) {
      entry = emptyTagColumns();
      map.set(r.itemId, entry);
    }
    if (OA_NODE_TYPES.includes(r.nodeType)) {
      if (!entry.oaName) {
        entry.oaName = r.nodeName;
        entry.oaCode = r.nodeCode ?? null;
      }
    } else if (TEXT_TYPE_NODE_TYPES.includes(r.nodeType)) {
      if (!entry.textType) entry.textType = r.nodeName;
    } else if (AXIS_NODE_TYPES.includes(r.nodeType)) {
      if (!entry.axis) entry.axis = r.nodeName;
    } else if (SKILL_NODE_TYPES.includes(r.nodeType)) {
      if (!entry.skill) entry.skill = r.nodeName;
    } else if (INDICATOR_NODE_TYPES.includes(r.nodeType)) {
      if (!entry.indicator) entry.indicator = r.nodeName;
    }
  }
  return map;
}

/**
 * Distribución de respuestas por ítem y alternativa, desde el read-model de
 * cohorte (1 query).
 *
 * Antes esto era la SEGUNDA copia del mismo `GROUP BY` sobre `responses` (la otra
 * vivía en `item-analysis.service.ts`), con la precedencia `raw | key | answer`
 * duplicada en SQL y en TypeScript. Ahora ambas leen el mismo read-model y la
 * precedencia vive una sola vez, en el calculador puro de `@soe/types`.
 *
 * ⚠️ Recombinar cursos es SUMA de conteos, nunca promedio de porcentajes: los
 * porcentajes se recalculan en el caller sobre el total recombinado.
 *
 * Paridad con el `GROUP BY` que reemplaza:
 *  · `totalResponses` = `sum(response_count)` = el `count(*)` de filas de respuesta
 *    → incluye los blancos en el denominador, igual que antes.
 *  · `answeredCount` sólo suma los buckets con `key !== null` (el blanco es el
 *    bucket `key: null`), y `blankCount` sigue derivándose como la diferencia.
 *  · Los ítems sin filas en el read-model quedan AUSENTES del Map (no en cero),
 *    para que el caller los resuelva con su propio default.
 */
export async function loadItemDistributions(
  tx: Database,
  assessmentId: string,
  itemIds: string[],
  classGroupFilter: string[] | null,
): Promise<Map<string, ItemAnswerDistribution>> {
  const result = new Map<string, ItemAnswerDistribution>();
  const byItem = await loadCohortStatsByItem(tx, assessmentId, itemIds, classGroupFilter);

  for (const [itemId, stat] of byItem) {
    const entry: ItemAnswerDistribution = {
      totalResponses: stat.responseCount,
      answeredCount: 0,
      correctCount: stat.correctCount,
      byAnswer: new Map(),
    };
    for (const bucket of stat.answerCounts) {
      if (bucket.key === null) continue; // blanco: cuenta en totalResponses, no en answeredCount
      entry.answeredCount += bucket.count;
      // Suma sobre las variantes de isCorrect de una misma clave.
      entry.byAnswer.set(bucket.key, (entry.byAnswer.get(bucket.key) ?? 0) + bucket.count);
    }
    result.set(itemId, entry);
  }
  return result;
}

/**
 * Filas del read-model de cohorte recombinadas por ítem (1 query).
 *
 * Las cohortes se juntan SUMANDO conteos — `mergeAnswerCounts` del calculador puro
 * es la primitiva compartida con `item-analysis`. Los porcentajes los recalcula el
 * caller sobre el total ya recombinado, nunca promediando los de cada curso.
 */
async function loadCohortStatsByItem(
  tx: Database,
  assessmentId: string,
  itemIds: string[],
  classGroupFilter: string[] | null,
): Promise<
  Map<string, { responseCount: number; correctCount: number; answerCounts: AnswerCount[] }>
> {
  const result = new Map<
    string,
    { responseCount: number; correctCount: number; answerCounts: AnswerCount[] }
  >();
  if (itemIds.length === 0) return result;
  if (classGroupFilter !== null && classGroupFilter.length === 0) return result;

  const conditions = [
    eq(assessmentItemStats.assessmentId, assessmentId),
    inArray(assessmentItemStats.itemId, itemIds),
  ];
  if (classGroupFilter !== null) {
    conditions.push(inArray(assessmentItemStats.classGroupId, classGroupFilter));
  }

  const rows = await tx
    .select({
      itemId: assessmentItemStats.itemId,
      responseCount: assessmentItemStats.responseCount,
      correctCount: assessmentItemStats.correctCount,
      answerCounts: assessmentItemStats.answerCounts,
    })
    .from(assessmentItemStats)
    .where(and(...conditions));

  // Agrupar las cohortes por ítem antes de recombinar sus distribuciones.
  const bucketsByItem = new Map<string, AnswerCount[][]>();
  for (const r of rows) {
    let acc = result.get(r.itemId);
    if (!acc) {
      acc = { responseCount: 0, correctCount: 0, answerCounts: [] };
      result.set(r.itemId, acc);
      bucketsByItem.set(r.itemId, []);
    }
    acc.responseCount += Number(r.responseCount);
    acc.correctCount += Number(r.correctCount);
    bucketsByItem.get(r.itemId)!.push(r.answerCounts ?? []);
  }
  for (const [itemId, buckets] of bucketsByItem) {
    result.get(itemId)!.answerCounts = mergeAnswerCounts(buckets);
  }
  return result;
}

/**
 * Distribución RC/RPC/RI/N por ítem de desarrollo, desde el read-model (1 query).
 *
 * Ya no categoriza nada: para un ítem sin alternativas el read-model guarda la
 * categoría por puntaje COMO la clave del bucket ('RC'|'RPC'|'RI', y `key: null`
 * para N). La clasificación vive una sola vez, en `classifyDevelopmentResponse` del
 * calculador puro, que replica el `case` SQL que este lector usaba antes. Son las
 * mismas claves que trae el informe oficial DIA → computed e imported convergen y
 * este lector sirve a los dos sin ramificar por origen.
 *
 * ⚠️ Cambio de semántica en `blankCount` (no en esta función, sí en su caller): el
 * `answeredCount` de un ítem de desarrollo antes daba 0 — la respuesta cruda no
 * lleva alternativa, así que todas contaban como blanco y `blankCount` salía igual
 * al total. Ahora RC/RPC/RI son claves no nulas, y el blanco queda reducido a N (sin
 * puntaje), que es lo que el propio informe llama "No responde".
 */
export async function loadDevelopmentDistributions(
  tx: Database,
  assessmentId: string,
  itemIds: string[],
  classGroupFilter: string[] | null,
): Promise<Map<string, DevelopmentDistribution>> {
  const result = new Map<string, DevelopmentDistribution>();
  const byItem = await loadCohortStatsByItem(tx, assessmentId, itemIds, classGroupFilter);

  for (const [itemId, stat] of byItem) {
    const entry: DevelopmentDistribution = { rc: 0, rpc: 0, ri: 0, n: 0 };
    for (const bucket of stat.answerCounts) {
      // Se suma sobre las variantes de isCorrect de una misma categoría: el bucket
      // está agrupado por (key, isCorrect) y acá sólo importa la categoría.
      if (bucket.key === 'RC') entry.rc += bucket.count;
      else if (bucket.key === 'RPC') entry.rpc += bucket.count;
      else if (bucket.key === 'RI') entry.ri += bucket.count;
      else if (bucket.key === null) entry.n += bucket.count;
      // Una clave ajena al set (un ítem con alternativas colado en devItemIds) se
      // ignora en vez de caer en `n`: antes el `else` del case la habría contado
      // como "no responde", inventando blancos.
    }
    result.set(itemId, entry);
  }
  return result;
}

function parseAlternatives(content: ItemContentRaw): ItemAlternativeDef[] {
  if (!Array.isArray(content.alternatives)) return [];
  const out: ItemAlternativeDef[] = [];
  for (const raw of content.alternatives) {
    if (!raw || typeof raw !== 'object') continue;
    const alt = raw as ItemAlternativeRaw;
    if (typeof alt.key !== 'string') continue;
    out.push({
      key: alt.key,
      text: typeof alt.text === 'string' ? alt.text : null,
      isCorrect: alt.isCorrect === true,
    });
  }
  return out;
}

function deriveCorrectKey(
  content: ItemContentRaw,
  alternatives: ItemAlternativeDef[],
): string | null {
  if (typeof content.correctKey === 'string' && content.correctKey.length > 0) {
    return content.correctKey;
  }
  const correct = alternatives.find((a) => a.isCorrect);
  return correct ? correct.key : null;
}
