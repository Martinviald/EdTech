// Helpers de narrowing para `rawAnswer: unknown`. Las estrategias nunca usan
// `any`: estrechan explícitamente el valor crudo del alumno antes de corregir.

/** `rawAnswer` como string trim, o `null` si no es string utilizable (no respondió). */
export function asTrimmedString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length === 0 ? null : t;
}

/** `rawAnswer` como lista de strings (acepta array o un JSON string serializado). */
export function asStringArray(raw: unknown): string[] | null {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const v of raw) {
      if (typeof v !== 'string') return null;
      out.push(v);
    }
    return out;
  }
  if (typeof raw === 'string') {
    const parsed = tryParseJson(raw);
    if (Array.isArray(parsed)) return asStringArray(parsed);
  }
  return null;
}

/** `rawAnswer` como objeto plano (acepta objeto o JSON string serializado). */
export function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    const parsed = tryParseJson(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return null;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Comparación de strings, insensible a mayúsculas y espacios salvo que se pida caseSensitive. */
export function normalizeAnswer(value: string, caseSensitive: boolean): string {
  const trimmed = value.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}
