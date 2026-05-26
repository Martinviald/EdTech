/**
 * Builds the system + user prompts for Claude API calls that suggest
 * taxonomy tags for assessment items.
 *
 * Pure function — no side-effects, easy to unit-test.
 */

export interface PromptItem {
  id: string;
  type: string;
  content: Record<string, unknown>;
}

export interface PromptNode {
  id: string;
  name: string;
  type: string;
  code: string | null;
}

export interface AiSuggestionRaw {
  nodeId: string;
  confidence: number;
  reasoning: string;
}

export function buildTaggingPrompt(
  item: PromptItem,
  nodes: PromptNode[],
): { system: string; user: string } {
  const system = `Eres un experto en alineamiento curricular del sistema educativo chileno (MINEDUC).
Tu tarea es analizar preguntas de evaluación y determinar qué objetivos de aprendizaje (OA), habilidades y contenidos del currículum evalúa cada pregunta.

Responde SOLO con un JSON array válido. Cada elemento tiene:
- nodeId: el UUID del nodo de taxonomía
- confidence: número entre 0 y 1
- reasoning: explicación breve de por qué esta pregunta se alinea con este nodo

Criterios:
- confidence >= 0.8: alineamiento claro y directo
- confidence 0.5-0.8: alineamiento parcial o indirecto
- No incluyas nodos con confidence < 0.5

Si ningún nodo aplica, responde con un array vacío: []`;

  const nodesForPrompt = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    code: n.code,
  }));

  const user = `## Nodos de taxonomía disponibles:
${JSON.stringify(nodesForPrompt, null, 2)}

## Pregunta a analizar:
Tipo: ${item.type}
Contenido: ${JSON.stringify(item.content, null, 2)}

Responde con el JSON array de sugerencias:`;

  return { system, user };
}

/**
 * Parses Claude's text response into a typed array of suggestions.
 * Returns an empty array if parsing fails.
 */
export function parseAiResponse(raw: string): AiSuggestionRaw[] {
  const trimmed = raw.trim();

  // Try to extract JSON array from the response — Claude may wrap it in markdown
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is AiSuggestionRaw =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).nodeId === 'string' &&
        typeof (item as Record<string, unknown>).confidence === 'number' &&
        typeof (item as Record<string, unknown>).reasoning === 'string' &&
        (item as AiSuggestionRaw).confidence >= 0.5 &&
        (item as AiSuggestionRaw).confidence <= 1,
    );
  } catch {
    return [];
  }
}
