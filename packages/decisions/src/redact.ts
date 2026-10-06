/**
 * Redacción de datos personales antes de enviar un estado a un motor externo.
 * Es una red de seguridad, no un sustituto de no enviar datos de alumnos.
 */

import type { DecisionState, JsonValue } from './contracts';

export const REDACTED = '[redactado]';

/** Nombres de clave (sin tildes, en minúsculas) cuyo VALOR se redacta completo. */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'nombre',
  'nombres',
  'apellido',
  'apellidos',
  'name',
  'first_name',
  'last_name',
  'full_name',
  'rut',
  'email',
  'correo',
  'telefono',
  'phone',
]);

const RUT_PATTERN = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export interface RedactionResult {
  readonly state: DecisionState;
  /** Cantidad de reemplazos hechos. */
  readonly redactions: number;
}

/**
 * Reemplaza por `'[redactado]'` los RUT y emails dentro de los strings, y el valor
 * de las claves sensibles (`SENSITIVE_KEYS`) en objetos anidados. No muta la entrada.
 * Un valor `null` en una clave sensible se deja tal cual y no cuenta.
 */
export function redactState(state: DecisionState): RedactionResult {
  const counter = { n: 0 };
  // `DecisionState` es un subconjunto de `JsonValue` y la redacción preserva la
  // categoría raíz (string → string, objeto → objeto, arreglo → arreglo).
  const redacted = redactValue(state, counter) as DecisionState;
  return { state: redacted, redactions: counter.n };
}

function normalizeKey(key: string): string {
  return key.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function redactString(text: string, counter: { n: number }): string {
  const replace = (): string => {
    counter.n += 1;
    return REDACTED;
  };
  return text.replace(RUT_PATTERN, replace).replace(EMAIL_PATTERN, replace);
}

function redactValue(value: JsonValue, counter: { n: number }): JsonValue {
  if (typeof value === 'string') return redactString(value, counter);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, counter));

  const out: { [key: string]: JsonValue } = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(normalizeKey(key)) && child !== null) {
      counter.n += 1;
      out[key] = REDACTED;
    } else {
      out[key] = redactValue(child, counter);
    }
  }
  return out;
}
