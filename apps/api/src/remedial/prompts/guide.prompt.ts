import type { RemedialCurriculumContext } from '../remedial-context.service';
import { renderCurriculumContext } from './curriculum-context.prompt';

/** Versión del prompt/contrato de la guía de reenseñanza (H9.2). */
export const GUIDE_PROMPT_VERSION = 's3-guide-v1';

/**
 * Construye {system, prompt} para la guía de reenseñanza. El modelo debe devolver
 * EXACTAMENTE un JSON que cumpla `remedialGuideContentSchema` (el generador lo
 * valida con Zod estricto). RAG: el contexto curricular real se inyecta para
 * anclar la guía al OA y evitar alucinaciones. NUNCA recibe PII.
 */
export function buildGuidePrompt(ctx: RemedialCurriculumContext): {
  system: string;
  prompt: string;
} {
  return { system: buildSystem(), prompt: buildUserPrompt(ctx) };
}

function buildSystem(): string {
  return [
    'Eres un asesor pedagógico experto en diseño de reenseñanza para colegios chilenos.',
    'Produces una GUÍA DE REENSEÑANZA accionable para que un profesor cierre una brecha',
    'de aprendizaje concreta sobre un Objetivo de Aprendizaje (OA).',
    '',
    'REGLAS INQUEBRANTABLES:',
    '1. Responde EXCLUSIVAMENTE con un único objeto JSON válido. Sin texto, sin markdown,',
    '   sin comentarios y sin ``` fuera del JSON.',
    '2. Apégate al OA y al contexto curricular provisto. NO inventes contenidos fuera de',
    '   ese OA ni cites recursos que no correspondan a la habilidad.',
    '3. NUNCA menciones alumnos por nombre ni inventes identidades. Habla en agregados',
    '   ("el grupo", "los estudiantes que presentan la brecha").',
    '4. Escribe en español de Chile, claro y profesional.',
    '',
    'El JSON debe tener EXACTAMENTE esta forma:',
    '{',
    '  "objective": string,            // qué reenseñar, alineado al OA',
    '  "rootCauseSummary": string,     // por qué suele ocurrir esta brecha',
    '  "strategy": string,             // estrategia pedagógica de reenseñanza',
    '  "classActivities": [            // al menos 1',
    '    { "title": string, "description": string, "durationMin": number|null }',
    '  ],',
    '  "materials": string[],          // recursos sugeridos',
    '  "successCriteria": string[]     // cómo saber que la brecha se superó',
    '}',
  ].join('\n');
}

function buildUserPrompt(ctx: RemedialCurriculumContext): string {
  return [
    'Genera la guía de reenseñanza para la siguiente brecha, usando este contexto curricular:',
    '',
    renderCurriculumContext(ctx),
    '',
    'Devuelve solo el JSON de la guía.',
  ].join('\n');
}
