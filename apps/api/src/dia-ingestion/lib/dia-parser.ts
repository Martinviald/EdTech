import type { DiaRawPayload, DiaRawItem } from './dia-sample-data';

/**
 * Result of parsing a single DIA item into the internal format
 * ready for insertion into the `items` table.
 */
export interface ParsedDiaItem {
  position: number;
  type: 'multiple_choice';
  content: MultipleChoiceContent;
  skillName: string;
  oaCode: string | null;
  contentAxis: string | null;
}

export interface MultipleChoiceContent {
  stem: string;
  alternatives: Array<{ key: string; text: string }>;
  correctKey: string;
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

const VALID_KEYS = ['A', 'B', 'C', 'D'] as const;

/**
 * Parses a DIA raw payload into a validated internal structure.
 *
 * This parser is a pure function with no side-effects — it does not
 * touch the database. It validates each item and collects errors.
 * A result with errors.length > 0 means some items have issues but
 * valid items are still returned.
 */
export function parseDiaPayload(payload: DiaRawPayload): DiaParseResult {
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
    const itemErrors = validateDiaItem(rawItem);
    if (itemErrors.length > 0) {
      errors.push(...itemErrors);
      continue;
    }

    parsedItems.push({
      position: rawItem.position,
      type: 'multiple_choice',
      content: {
        stem: rawItem.stem ?? `Pregunta ${rawItem.position}`,
        alternatives: rawItem.alternatives.map((alt) => ({
          key: alt.key,
          text: alt.text ?? '',
        })),
        correctKey: rawItem.correctKey.toUpperCase(),
      },
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

function validateDiaItem(item: DiaRawItem): DiaParseError[] {
  const errors: DiaParseError[] = [];

  if (typeof item.position !== 'number' || item.position < 1) {
    errors.push({
      position: item.position ?? null,
      field: 'position',
      message: `La posición debe ser un número positivo`,
    });
  }

  if (!item.correctKey || !VALID_KEYS.includes(item.correctKey.toUpperCase() as typeof VALID_KEYS[number])) {
    errors.push({
      position: item.position,
      field: 'correctKey',
      message: `La clave correcta debe ser A, B, C o D (recibido: "${item.correctKey}")`,
    });
  }

  if (!item.alternatives || item.alternatives.length < 2) {
    errors.push({
      position: item.position,
      field: 'alternatives',
      message: 'Debe tener al menos 2 alternativas',
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
