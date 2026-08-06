import type { ItemType } from '../enums';
import { DEVELOPMENT_BUCKETS, type DevelopmentBucket } from './item-stats-calculator';

// ─────────────────────────────────────────────────────────────────────────────
// Clave / respuesta correcta normalizada por tipo de ítem.
//
// `deriveAnswerKey(type, content)` es la ÚNICA fuente de "cuál es la respuesta
// correcta" según el `item_type`, compartida entre el backend (que la expone en
// `QuestionAnalysisResponse` / el snapshot de IA) y el frontend (que la renderiza
// con `AnswerKeyView`). Es pura: opera solo sobre sus parámetros, sin `db`.
//
// Extensibilidad: agregar un tipo nuevo = agregar su rama aquí. El default es
// `{ kind: 'none' }`, así un tipo sin clave declarada nunca rompe la vista.
// ─────────────────────────────────────────────────────────────────────────────

export type AnswerKeyAlternative = {
  key: string;
  text: string | null;
  isCorrect: boolean;
};

export type AnswerKeyMatchingElement = {
  id: string;
  text: string;
  label?: string;
  isImage?: boolean;
};

export type AnswerKeyMatchingPair = { leftId: string; rightId: string };

export type AnswerKeyOrderingItem = { id: string; text: string };

export type AnswerKeyGap = { position: number; acceptedAnswers: string[] };

export type AnswerKeyRubricLevel = {
  code: string;
  label: string | null;
  descriptor: string | null;
  creditFraction: number;
};

/** Clave normalizada de un ítem, discriminada por `kind` (derivado del `item_type`). */
export type AnswerKey =
  | { kind: 'choice'; correctKey: string | null; alternatives: AnswerKeyAlternative[] }
  | { kind: 'multi_choice'; correctKeys: string[]; alternatives: AnswerKeyAlternative[] }
  | { kind: 'true_false'; correctAnswer: boolean }
  | {
      kind: 'matching';
      leftItems: AnswerKeyMatchingElement[];
      rightItems: AnswerKeyMatchingElement[];
      correctPairs: AnswerKeyMatchingPair[];
    }
  | { kind: 'ordering'; items: AnswerKeyOrderingItem[]; correctOrder: string[] }
  | { kind: 'short_answer'; acceptedAnswers: string[] }
  | { kind: 'gap_fill'; gaps: AnswerKeyGap[] }
  | { kind: 'sample_answer'; sampleAnswer: string | null; rubricId: string | null }
  | { kind: 'rubric_levels'; levels: AnswerKeyRubricLevel[]; rubricId: string | null }
  | { kind: 'none' };

type Content = Record<string, unknown> | null | undefined;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalUuid(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readAlternatives(content: Content): AnswerKeyAlternative[] {
  const raw = content?.['alternatives'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (alt): alt is Record<string, unknown> =>
        typeof alt === 'object' && alt !== null && 'key' in alt,
    )
    .map((alt) => ({
      key: String(alt['key']),
      text: str(alt['text']),
      isCorrect: alt['isCorrect'] === true,
    }));
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function readMatchingElements(value: unknown): AnswerKeyMatchingElement[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (el): el is Record<string, unknown> => typeof el === 'object' && el !== null && 'id' in el,
    )
    .map((el) => ({
      id: String(el['id']),
      text: str(el['text']) ?? '',
      label: str(el['label']) ?? undefined,
      isImage: el['isImage'] === true,
    }));
}

/**
 * Deriva la clave/respuesta correcta normalizada de un ítem a partir de su `type`
 * y su `content` JSONB. No lanza: ante un `content` malformado devuelve la rama
 * más segura (`kind: 'none'` o listas vacías).
 */
export function deriveAnswerKey(type: ItemType, content: Content): AnswerKey {
  switch (type) {
    case 'multiple_choice':
    case 'listening': {
      const alternatives = readAlternatives(content);
      if (alternatives.length === 0) return { kind: 'none' };
      const correct = alternatives.find((alt) => alt.isCorrect);
      return { kind: 'choice', correctKey: correct?.key ?? null, alternatives };
    }
    case 'multi_select': {
      const alternatives = readAlternatives(content);
      const correctKeys = alternatives.filter((alt) => alt.isCorrect).map((alt) => alt.key);
      return { kind: 'multi_choice', correctKeys, alternatives };
    }
    case 'true_false':
      return { kind: 'true_false', correctAnswer: content?.['correctAnswer'] === true };
    case 'matching':
      return {
        kind: 'matching',
        leftItems: readMatchingElements(content?.['leftItems']),
        rightItems: readMatchingElements(content?.['rightItems']),
        correctPairs: Array.isArray(content?.['correctPairs'])
          ? (content['correctPairs'] as unknown[])
              .filter(
                (p): p is Record<string, unknown> =>
                  typeof p === 'object' && p !== null && 'leftId' in p && 'rightId' in p,
              )
              .map((p) => ({ leftId: String(p['leftId']), rightId: String(p['rightId']) }))
          : [],
      };
    case 'ordering': {
      const items = Array.isArray(content?.['items'])
        ? (content['items'] as unknown[])
            .filter(
              (it): it is Record<string, unknown> =>
                typeof it === 'object' && it !== null && 'id' in it,
            )
            .map((it) => ({ id: String(it['id']), text: str(it['text']) ?? '' }))
        : [];
      return { kind: 'ordering', items, correctOrder: readStringArray(content?.['correctOrder']) };
    }
    case 'short_answer':
      return {
        kind: 'short_answer',
        acceptedAnswers: readStringArray(content?.['acceptedAnswers']),
      };
    case 'gap_fill': {
      const gaps = Array.isArray(content?.['gaps'])
        ? (content['gaps'] as unknown[])
            .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null)
            .map((g) => ({
              position: typeof g['position'] === 'number' ? g['position'] : 0,
              acceptedAnswers: readStringArray(g['acceptedAnswers']),
            }))
        : [];
      return { kind: 'gap_fill', gaps };
    }
    case 'rubric_scored': {
      const levels = Array.isArray(content?.['levels'])
        ? (content['levels'] as unknown[])
            .filter(
              (l): l is Record<string, unknown> =>
                typeof l === 'object' && l !== null && 'code' in l,
            )
            .map((l) => ({
              code: String(l['code']),
              label: str(l['label']),
              descriptor: str(l['descriptor']),
              creditFraction: typeof l['creditFraction'] === 'number' ? l['creditFraction'] : 0,
            }))
        : [];
      return { kind: 'rubric_levels', levels, rubricId: optionalUuid(content?.['rubricId']) };
    }
    case 'open_ended':
    case 'writing':
    case 'oral_reading':
    case 'oral_expression':
      return {
        kind: 'sample_answer',
        sampleAnswer: str(content?.['sampleAnswer']),
        rubricId: optionalUuid(content?.['rubricId']),
      };
    default:
      return { kind: 'none' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribución por categoría de puntaje (ítems de desarrollo: RC / RPC / RI).
// ─────────────────────────────────────────────────────────────────────────────

/** Una categoría de puntaje con su conteo y proporción. */
export type ScoreCategoryDistribution = {
  key: DevelopmentBucket;
  label: string;
  count: number;
  percentage: number; // 0..100 sobre el total de respuestas
  credit: number; // 1 | 0.5 | 0 — para colorear por nivel de logro
};

/** Metadatos presentables de cada categoría de puntaje de desarrollo. */
export const SCORE_CATEGORY_META: Record<DevelopmentBucket, { label: string; credit: number }> = {
  RC: { label: 'Correcta', credit: 1 },
  RPC: { label: 'Parcial', credit: 0.5 },
  RI: { label: 'Incorrecta', credit: 0 },
};

/** `true` si la clave de un bucket es una categoría de puntaje de desarrollo. */
export function isDevelopmentBucket(key: string | null): key is DevelopmentBucket {
  return key !== null && (DEVELOPMENT_BUCKETS as readonly string[]).includes(key);
}
