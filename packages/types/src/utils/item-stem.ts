// Enunciado de un ítem, sea cual sea su tipo.
//
// `content` es polimórfico (ver `ITEM_CONTENT_SCHEMAS`) y el enunciado no siempre
// vive bajo la misma clave: los tipos con alternativas usan `stem`, los de
// desarrollo/respuesta corta/pauta usan `prompt`, la lectura oral usa `passage` y
// el completar-espacios usa `textWithGaps`.
//
// Leer sólo `stem` es el bug que dejaba sin enunciado a los ítems que no son de
// alternativas: existía la cadena correcta en el banco de ítems y en el asistente,
// pero no en el análisis por pregunta ni en los snapshots que alimentan a la IA.
// Por eso vive acá, en un único lugar que todos importan.

/** Claves donde puede vivir el enunciado, en orden de preferencia. */
const STEM_KEYS = ['stem', 'prompt', 'passage', 'textWithGaps'] as const;

/**
 * Primera clave textual no vacía del `content` de un ítem, o `null` si no hay
 * ninguna. Un tipo nuevo que estrene una clave de enunciado se agrega a `STEM_KEYS`.
 */
export function extractItemStem(content: unknown): string | null {
  if (content === null || typeof content !== 'object') return null;
  const record = content as Record<string, unknown>;
  for (const key of STEM_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/** `extractItemStem` truncado con elipsis, para payloads que sólo quieren una vista previa. */
export function extractItemStemPreview(content: unknown, maxChars: number): string | null {
  const stem = extractItemStem(content);
  if (stem === null) return null;
  return stem.length > maxChars ? `${stem.slice(0, maxChars)}…` : stem;
}
