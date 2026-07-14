import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { itemTaxonomyTags, items, responses, taxonomyNodes } from '@soe/db';
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

async function loadTagColumns(
  tx: Database,
  itemIds: string[],
): Promise<Map<string, TagColumns>> {
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

/** Distribución de respuestas por ítem y alternativa (1 query). */
export async function loadItemDistributions(
  tx: Database,
  assessmentId: string,
  itemIds: string[],
  studentFilter: string[] | null,
): Promise<Map<string, ItemAnswerDistribution>> {
  const result = new Map<string, ItemAnswerDistribution>();
  if (itemIds.length === 0) return result;
  if (studentFilter !== null && studentFilter.length === 0) return result;

  const conditions = [
    eq(responses.assessmentId, assessmentId),
    inArray(responses.itemId, itemIds),
  ];
  if (studentFilter !== null) {
    conditions.push(inArray(responses.studentId, studentFilter));
  }

  const answerExpr = sql<
    string | null
  >`nullif(coalesce(${responses.value}->>'raw', ${responses.value}->>'key', ${responses.value}->>'answer'), '')`;

  const rows = await tx
    .select({
      itemId: responses.itemId,
      answer: answerExpr,
      isCorrect: sql<boolean>`coalesce(${responses.isCorrect}, false)`,
      count: sql<number>`count(*)::int`,
    })
    .from(responses)
    .where(and(...conditions))
    .groupBy(responses.itemId, answerExpr, responses.isCorrect);

  for (const r of rows) {
    const count = Number(r.count);
    let entry = result.get(r.itemId);
    if (!entry) {
      entry = { totalResponses: 0, answeredCount: 0, correctCount: 0, byAnswer: new Map() };
      result.set(r.itemId, entry);
    }
    entry.totalResponses += count;
    if (r.answer !== null) {
      entry.answeredCount += count;
      entry.byAnswer.set(r.answer, (entry.byAnswer.get(r.answer) ?? 0) + count);
    }
    if (r.isCorrect === true) entry.correctCount += count;
  }
  return result;
}

/**
 * Distribución RC/RPC/RI/N por ítem de desarrollo (1 query). Categoriza cada
 * respuesta por su puntaje (final_score o raw_score) sobre el máximo del ítem.
 */
export async function loadDevelopmentDistributions(
  tx: Database,
  assessmentId: string,
  itemIds: string[],
  studentFilter: string[] | null,
): Promise<Map<string, DevelopmentDistribution>> {
  const result = new Map<string, DevelopmentDistribution>();
  if (itemIds.length === 0) return result;
  if (studentFilter !== null && studentFilter.length === 0) return result;

  const conditions = [
    eq(responses.assessmentId, assessmentId),
    inArray(responses.itemId, itemIds),
  ];
  if (studentFilter !== null) {
    conditions.push(inArray(responses.studentId, studentFilter));
  }

  // Categoría por puntaje: N (sin puntaje) / RI (0) / RC (== max) / RPC (0<score<max).
  const categoryExpr = sql<string>`
    case
      when coalesce(${responses.finalScore}, ${responses.rawScore}) is null then 'N'
      when coalesce(${responses.finalScore}, ${responses.rawScore}) <= 0 then 'RI'
      when coalesce(${responses.finalScore}, ${responses.rawScore}) >= ${responses.maxScore} then 'RC'
      else 'RPC'
    end`;

  const rows = await tx
    .select({
      itemId: responses.itemId,
      category: categoryExpr,
      count: sql<number>`count(*)::int`,
    })
    .from(responses)
    .where(and(...conditions))
    .groupBy(responses.itemId, categoryExpr);

  for (const r of rows) {
    let entry = result.get(r.itemId);
    if (!entry) {
      entry = { rc: 0, rpc: 0, ri: 0, n: 0 };
      result.set(r.itemId, entry);
    }
    const count = Number(r.count);
    if (r.category === 'RC') entry.rc += count;
    else if (r.category === 'RPC') entry.rpc += count;
    else if (r.category === 'RI') entry.ri += count;
    else entry.n += count;
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
