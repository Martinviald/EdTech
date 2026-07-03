import type { RemedialCurriculumContext } from '../remedial-context.service';
import { renderCurriculumContext } from './curriculum-context.prompt';

/** Versión del prompt/contrato del set de ítems de práctica (H9.3). */
export const PRACTICE_PROMPT_VERSION = 's3-practice-v1';

/**
 * Construye {system, prompt} para generar N ítems de práctica de selección
 * múltiple sobre la habilidad débil. El modelo devuelve un JSON con un arreglo de
 * ítems (el generador valida cada `content` con `validateItemContent`). RAG: el
 * contexto curricular real ancla el nivel/estilo. NUNCA recibe PII.
 */
export function buildPracticePrompt(
  ctx: RemedialCurriculumContext,
  itemCount: number,
): { system: string; prompt: string } {
  return {
    system: buildSystem(itemCount),
    prompt: buildUserPrompt(ctx, itemCount),
  };
}

function buildSystem(itemCount: number): string {
  return [
    'Eres un experto en construcción de ítems de evaluación para colegios chilenos.',
    `Generas EXACTAMENTE ${itemCount} ítems de práctica de selección múltiple para`,
    'reforzar una habilidad débil sobre un Objetivo de Aprendizaje (OA).',
    '',
    'REGLAS INQUEBRANTABLES:',
    '1. Responde EXCLUSIVAMENTE con un único objeto JSON válido. Sin texto, sin markdown,',
    '   sin comentarios y sin ``` fuera del JSON.',
    '2. Cada ítem evalúa el OA provisto. Usa el contexto curricular y los ítems de',
    '   referencia para calibrar nivel y estilo. NO inventes contenido fuera del OA.',
    '3. Cada ítem es de selección múltiple con 4 alternativas; EXACTAMENTE UNA correcta.',
    '4. NUNCA incluyas datos de alumnos. Los ítems son genéricos.',
    '5. Escribe en español de Chile.',
    '',
    'El JSON debe tener EXACTAMENTE esta forma:',
    '{',
    '  "skillFocus": string,           // resumen de la habilidad reforzada',
    '  "notes": string|null,           // notas para el profesor (o null)',
    '  "items": [                      // exactamente ' + itemCount + ' ítems',
    '    {',
    '      "stem": string,             // enunciado',
    '      "alternatives": [           // 4 alternativas',
    '        { "key": "A", "text": string, "isCorrect": boolean },',
    '        { "key": "B", "text": string, "isCorrect": boolean },',
    '        { "key": "C", "text": string, "isCorrect": boolean },',
    '        { "key": "D", "text": string, "isCorrect": boolean }',
    '      ],',
    '      "explanation": string       // por qué la correcta es correcta',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

function buildUserPrompt(
  ctx: RemedialCurriculumContext,
  itemCount: number,
): string {
  return [
    `Genera ${itemCount} ítems de práctica para la siguiente brecha, usando este contexto curricular:`,
    '',
    renderCurriculumContext(ctx),
    '',
    'Devuelve solo el JSON del set de ítems.',
  ].join('\n');
}
