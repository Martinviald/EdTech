import type { MultipleChoiceContent } from '@soe/types';
import type { DiaRawPayload, DiaRawItem } from './dia-sample-data';

/**
 * Result of parsing a single DIA item into the internal format
 * ready for insertion into the `items` table.
 *
 * `content` ahora es el shape CANÓNICO de `@soe/types`
 * (`MultipleChoiceContent`: `{ stem, alternatives: [{ key, text, isCorrect }], ... }`),
 * de modo que pase `validateItemContent('multiple_choice', content)` sin transformación.
 * La clave correcta queda como metadato a nivel de ítem (`correctKey`) y, además,
 * se refleja en `isCorrect` de cada alternativa.
 */
export interface ParsedDiaItem {
  position: number;
  /** Tipo de ítem. Hoy siempre `multiple_choice`; punto de extensión a V/F u otros. */
  type: 'multiple_choice';
  /** Contenido canónico (@soe/types). `alternatives[i].isCorrect` deriva de `correctKey`. */
  content: MultipleChoiceContent;
  /** Clave correcta normalizada (mayúsculas). Redundante con `isCorrect`, útil para debug/tags. */
  correctKey: string;
  skillName: string;
  oaCode: string | null;
  contentAxis: string | null;
}

export interface ParsedDiaInstrument {
  name: string;
  subject: string;
  grade: string;
  year: number;
  applicationPeriod: string;
}

export interface DiaParseResult {
  instrument: ParsedDiaInstrument;
  items: ParsedDiaItem[];
  errors: DiaParseError[];
}

export interface DiaParseError {
  position: number | null;
  field: string;
  message: string;
}

/**
 * Opciones de parsing. Permiten parametrizar las claves de alternativa aceptadas
 * para soportar pruebas con más/menos opciones que el clásico A–D del DIA
 * (ej. PAES con 5 alternativas A–E, o ítems V/F con claves V/F).
 */
export interface DiaParseOptions {
  /**
   * Conjunto de claves válidas para `correctKey` y para las alternativas.
   * Si se omite, las claves válidas se DERIVAN de las alternativas presentes en
   * cada ítem (lo que soporta de forma natural A–D, A–E o cualquier set ≥2).
   * El default explícito documentado para una prueba homogénea de opción múltiple
   * es `DEFAULT_VALID_KEYS` (A–E), que cubre el DIA actual (A–D) y PAES (A–E).
   */
  validKeys?: readonly string[];
}

/**
 * Claves válidas por defecto: A–E. Cubre el banco DIA actual (A–D) y pruebas de
 * 5 alternativas (PAES). NO es un límite duro: si un ítem declara otras claves
 * (ej. V/F), basta pasarlas en `options.validKeys` o dejar que se deriven de las
 * propias alternativas del ítem.
 */
export const DEFAULT_VALID_KEYS = ['A', 'B', 'C', 'D', 'E'] as const;

/** Mínimo de alternativas exigido para un ítem de opción múltiple válido. */
export const MIN_ALTERNATIVES = 2;

/**
 * Parses a DIA raw payload into a validated internal structure.
 *
 * This parser is a pure function with no side-effects — it does not
 * touch the database. It validates each item and collects errors.
 * A result with errors.length > 0 means some items have issues but
 * valid items are still returned.
 *
 * @param payload  Payload crudo (instrumento + ítems).
 * @param options  Opciones de parsing (claves válidas configurables). Opcional.
 */
export function parseDiaPayload(
  payload: DiaRawPayload,
  options: DiaParseOptions = {},
): DiaParseResult {
  const errors: DiaParseError[] = [];

  // Validate instrument metadata
  if (!payload.instrument.name || payload.instrument.name.trim().length === 0) {
    errors.push({ position: null, field: 'instrument.name', message: 'El nombre del instrumento es obligatorio' });
  }
  if (!payload.instrument.subject || payload.instrument.subject.trim().length === 0) {
    errors.push({ position: null, field: 'instrument.subject', message: 'La asignatura es obligatoria' });
  }
  if (!payload.instrument.grade || payload.instrument.grade.trim().length === 0) {
    errors.push({ position: null, field: 'instrument.grade', message: 'El nivel es obligatorio' });
  }
  if (!payload.instrument.year || payload.instrument.year < 2000 || payload.instrument.year > 2100) {
    errors.push({ position: null, field: 'instrument.year', message: 'El año debe estar entre 2000 y 2100' });
  }
  if (!payload.instrument.applicationPeriod || payload.instrument.applicationPeriod.trim().length === 0) {
    errors.push({ position: null, field: 'instrument.applicationPeriod', message: 'El período de aplicación es obligatorio' });
  }

  if (!payload.items || payload.items.length === 0) {
    errors.push({ position: null, field: 'items', message: 'Debe contener al menos un ítem' });
    return {
      instrument: {
        name: payload.instrument.name ?? '',
        subject: payload.instrument.subject ?? '',
        grade: payload.instrument.grade ?? '',
        year: payload.instrument.year ?? 0,
        applicationPeriod: payload.instrument.applicationPeriod ?? '',
      },
      items: [],
      errors,
    };
  }

  const parsedItems: ParsedDiaItem[] = [];

  for (const rawItem of payload.items) {
    const validKeys = resolveValidKeys(rawItem, options.validKeys);
    const itemErrors = validateDiaItem(rawItem, validKeys);
    if (itemErrors.length > 0) {
      errors.push(...itemErrors);
      continue;
    }

    const correctKey = rawItem.correctKey.toUpperCase();
    const content: MultipleChoiceContent = {
      stem: rawItem.stem ?? `Pregunta ${rawItem.position}`,
      // Shape canónico: cada alternativa lleva `isCorrect` derivado de la clave correcta.
      alternatives: rawItem.alternatives.map((alt) => ({
        key: alt.key.toUpperCase(),
        text: alt.text ?? alt.key.toUpperCase(),
        isCorrect: alt.key.toUpperCase() === correctKey,
      })),
    };

    parsedItems.push({
      position: rawItem.position,
      type: 'multiple_choice',
      content,
      correctKey,
      skillName: rawItem.skill,
      oaCode: rawItem.oa ?? null,
      contentAxis: rawItem.contentAxis ?? null,
    });
  }

  return {
    instrument: {
      name: payload.instrument.name,
      subject: payload.instrument.subject,
      grade: payload.instrument.grade,
      year: payload.instrument.year,
      applicationPeriod: payload.instrument.applicationPeriod,
    },
    items: parsedItems,
    errors,
  };
}

/**
 * Resuelve el conjunto de claves válidas para un ítem:
 * 1. Si el caller pasó `validKeys` explícitas, se usan esas (normalizadas a mayúsculas).
 * 2. Si no, se derivan de las propias alternativas del ítem (soporta A–D, A–E, V/F…).
 * 3. Como último recurso (ítem sin alternativas), se usan las claves por defecto A–E.
 */
function resolveValidKeys(
  item: DiaRawItem,
  explicit: readonly string[] | undefined,
): Set<string> {
  if (explicit && explicit.length > 0) {
    return new Set(explicit.map((k) => k.toUpperCase()));
  }
  if (item.alternatives && item.alternatives.length > 0) {
    return new Set(item.alternatives.map((a) => a.key.toUpperCase()));
  }
  return new Set(DEFAULT_VALID_KEYS.map((k) => k));
}

function validateDiaItem(item: DiaRawItem, validKeys: Set<string>): DiaParseError[] {
  const errors: DiaParseError[] = [];

  if (typeof item.position !== 'number' || item.position < 1) {
    errors.push({
      position: item.position ?? null,
      field: 'position',
      message: `La posición debe ser un número positivo`,
    });
  }

  const expectedKeys = [...validKeys].join(', ');
  if (!item.correctKey || !validKeys.has(item.correctKey.toUpperCase())) {
    errors.push({
      position: item.position,
      field: 'correctKey',
      message: `La clave correcta debe ser una de [${expectedKeys}] (recibido: "${item.correctKey}")`,
    });
  }

  if (!item.alternatives || item.alternatives.length < MIN_ALTERNATIVES) {
    errors.push({
      position: item.position,
      field: 'alternatives',
      message: `Debe tener al menos ${MIN_ALTERNATIVES} alternativas`,
    });
  } else {
    // Verify correctKey is among alternatives
    const altKeys = item.alternatives.map((a) => a.key.toUpperCase());
    if (item.correctKey && !altKeys.includes(item.correctKey.toUpperCase())) {
      errors.push({
        position: item.position,
        field: 'correctKey',
        message: `La clave correcta "${item.correctKey}" no está entre las alternativas disponibles`,
      });
    }
  }

  if (!item.skill || item.skill.trim().length === 0) {
    errors.push({
      position: item.position,
      field: 'skill',
      message: 'La habilidad es obligatoria',
    });
  }

  return errors;
}
