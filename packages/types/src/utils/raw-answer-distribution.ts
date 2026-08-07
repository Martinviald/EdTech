import type { ItemType } from '../enums';

// ─────────────────────────────────────────────────────────────────────────────
// Distribución de respuestas EXACTAS de los alumnos para ítems no-MC estructurados
// (respuesta corta/número, ordenar, unir términos, completar). A diferencia de la
// distribución por categoría de puntaje (RC/RPC/RI), aquí se agrega por el VALOR
// que ingresó el alumno — que es lo que revela el error concreto ("pusieron 24 en
// vez de 21/10"). Agregada y anónima: valor → conteo, nunca por alumno.
//
// Se comparte entre el backend (que la calcula desde `responses.value` y la expone
// en `QuestionAnalysisResponse` y el snapshot de IA) y el frontend (barras). Pura.
// ─────────────────────────────────────────────────────────────────────────────

export type RawAnswerCount = {
  /** Valor legible ingresado por el alumno ("24", "B → A → C", "León → Mamífero"). */
  answer: string;
  count: number;
  isCorrect: boolean;
  percentage: number; // 0..100 sobre las respuestas con valor (excluye blancos)
};

/** Tipos con respuesta estructurada corta para los que el valor exacto es útil. */
export const RAW_ANSWER_DISTRIBUTION_TYPES = [
  'short_answer',
  'ordering',
  'matching',
  'gap_fill',
] as const;

export function supportsRawAnswerDistribution(type: ItemType): boolean {
  return (RAW_ANSWER_DISTRIBUTION_TYPES as readonly string[]).includes(type);
}

/** Cantidad máxima de valores distintos antes de agrupar el resto en "Otras". */
const MAX_DISTINCT = 12;

export type RawResponseRow = {
  value: Record<string, unknown> | null;
  isCorrect: boolean | null;
};

/**
 * Agrega las respuestas exactas de una lista de respuestas de alumnos a un ítem.
 * Renderiza cada valor a un texto legible según el tipo, agrupa por valor idéntico,
 * ordena por frecuencia y limita a `maxDistinct` (+ un bucket "Otras").
 */
export function buildRawAnswerDistribution(
  type: ItemType,
  content: Record<string, unknown>,
  responses: RawResponseRow[],
  maxDistinct: number = MAX_DISTINCT,
): RawAnswerCount[] {
  const render = renderStudentAnswer(type, content);
  const groups = new Map<string, { count: number; isCorrect: boolean }>();
  let considered = 0;

  for (const row of responses) {
    const answer = render(row.value);
    if (answer == null || answer.length === 0) continue;
    considered += 1;
    const prev = groups.get(answer);
    if (prev) prev.count += 1;
    else groups.set(answer, { count: 1, isCorrect: row.isCorrect === true });
  }

  if (considered === 0) return [];

  const sorted = [...groups.entries()]
    .map(([answer, g]) => ({
      answer,
      count: g.count,
      isCorrect: g.isCorrect,
      percentage: (g.count / considered) * 100,
    }))
    .sort((a, b) => b.count - a.count || (a.isCorrect === b.isCorrect ? 0 : a.isCorrect ? -1 : 1));

  if (sorted.length <= maxDistinct) return sorted;

  const top = sorted.slice(0, maxDistinct);
  const rest = sorted.slice(maxDistinct);
  const restCount = rest.reduce((sum, x) => sum + x.count, 0);
  top.push({
    answer: `Otras (${rest.length} respuestas distintas)`,
    count: restCount,
    isCorrect: false,
    percentage: (restCount / considered) * 100,
  });
  return top;
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderizado del valor crudo → texto legible, por tipo.
// ─────────────────────────────────────────────────────────────────────────────

type Renderer = (value: Record<string, unknown> | null) => string | null;

function renderStudentAnswer(type: ItemType, content: Record<string, unknown>): Renderer {
  switch (type) {
    case 'short_answer':
      return (value) => scalarAnswer(value);
    case 'ordering': {
      const textById = elementTextById(content['items']);
      return (value) => {
        const ids = coerceStringArray(pickRaw(value) ?? value);
        if (!ids || ids.length === 0) return null;
        return ids.map((id) => textById.get(id) ?? id).join(' → ');
      };
    }
    case 'matching': {
      const leftText = elementTextById(content['leftItems']);
      const rightText = elementTextById(content['rightItems']);
      const leftOrder = elementIds(content['leftItems']);
      return (value) => {
        const pairs = coercePairs(pickRaw(value) ?? value);
        if (pairs.size === 0) return null;
        const orderedLeftIds =
          leftOrder.length > 0 ? leftOrder.filter((id) => pairs.has(id)) : [...pairs.keys()];
        const parts = orderedLeftIds.map(
          (leftId) =>
            `${leftText.get(leftId) ?? leftId} → ${rightText.get(pairs.get(leftId) ?? '') ?? pairs.get(leftId)}`,
        );
        return parts.length > 0 ? parts.join(' · ') : null;
      };
    }
    case 'gap_fill': {
      const gapPositions = gapFillPositions(content['gaps']);
      return (value) => {
        const raw = pickRaw(value) ?? value;
        const arr = coerceStringArray(raw);
        const record =
          !arr && raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
        const parts = gapPositions.map((position, index) => {
          let answer: string | null = null;
          if (arr) answer = arr[index] ?? null;
          else if (record) {
            const byPosition = record[String(position)];
            const byIndex = record[String(index)];
            answer =
              typeof byPosition === 'string'
                ? byPosition
                : typeof byIndex === 'string'
                  ? byIndex
                  : null;
          }
          return `${index + 1}: ${answer && answer.length > 0 ? answer : '—'}`;
        });
        const anyAnswered = parts.some((p) => !p.endsWith('—'));
        return anyAnswered ? parts.join(' · ') : null;
      };
    }
    default:
      return () => null;
  }
}

/** Extrae el valor escalar de una respuesta (`value.raw ?? value.answer ?? value.key`). */
function scalarAnswer(value: Record<string, unknown> | null): string | null {
  const raw = pickRaw(value);
  if (raw == null) return null;
  const str = typeof raw === 'string' ? raw : String(raw);
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickRaw(value: Record<string, unknown> | null | undefined): unknown {
  if (!value || typeof value !== 'object') return null;
  return value['raw'] ?? value['answer'] ?? value['key'] ?? null;
}

/** Normaliza a arreglo de strings: acepta arreglo o string JSON de arreglo. */
function coerceStringArray(raw: unknown): string[] | null {
  if (Array.isArray(raw)) {
    return raw.map((x) => (typeof x === 'string' ? x : String(x)));
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((x) => String(x));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Normaliza a mapa leftId→rightId: acepta record o arreglo de {leftId,rightId}. */
function coercePairs(raw: unknown): Map<string, string> {
  const pairs = new Map<string, string>();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [leftId, rightId] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof rightId === 'string' && rightId.trim().length > 0)
        pairs.set(leftId, rightId.trim());
    }
    return pairs;
  }
  if (Array.isArray(raw)) {
    for (const pair of raw) {
      if (pair === null || typeof pair !== 'object') continue;
      const leftId = (pair as { leftId?: unknown }).leftId;
      const rightId = (pair as { rightId?: unknown }).rightId;
      if (typeof leftId === 'string' && typeof rightId === 'string' && rightId.trim().length > 0) {
        pairs.set(leftId, rightId.trim());
      }
    }
  }
  return pairs;
}

function elementTextById(raw: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(raw)) return map;
  for (const el of raw) {
    if (el && typeof el === 'object' && 'id' in el) {
      const id = String((el as { id: unknown }).id);
      const text = (el as { text?: unknown }).text;
      map.set(id, typeof text === 'string' && text.length > 0 ? text : id);
    }
  }
  return map;
}

function elementIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((el): el is { id: unknown } => !!el && typeof el === 'object' && 'id' in el)
    .map((el) => String(el.id));
}

function gapFillPositions(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((gap, index) =>
    gap && typeof gap === 'object' && typeof (gap as { position?: unknown }).position === 'number'
      ? (gap as { position: number }).position
      : index,
  );
}
