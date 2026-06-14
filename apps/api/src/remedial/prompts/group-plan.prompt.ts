import type { RemedialCurriculumContext } from '../remedial-context.service';
import { renderCurriculumContext } from './curriculum-context.prompt';

/** Versión del prompt/contrato del plan remedial por grupo (H9.4). */
export const GROUP_PLAN_PROMPT_VERSION = 's3-group-plan-v1';

/** Agregados deterministas (sin PII) que alimentan el plan. */
export interface GroupPlanAggregates {
  /** Conteo de alumnos bajo umbral en la habilidad (calculado en backend). */
  studentCount: number;
  /** Umbral de % de logro usado para definir el grupo (0..100). */
  thresholdPct: number;
  /** % de logro promedio del grupo bajo umbral (o null si no hay datos). */
  averagePct: number | null;
}

/**
 * Construye {system, prompt} para el plan remedial por grupo. La AGRUPACIÓN es
 * determinista en backend; la IA solo recibe AGREGADOS (conteo, umbral, promedio)
 * + contexto RAG y produce `groupLabel` (abstracto) + `sequence`. NUNCA recibe
 * PII (sin nombres, RUT ni ids de alumnos).
 */
export function buildGroupPlanPrompt(
  ctx: RemedialCurriculumContext,
  aggregates: GroupPlanAggregates,
): { system: string; prompt: string } {
  return {
    system: buildSystem(),
    prompt: buildUserPrompt(ctx, aggregates),
  };
}

function buildSystem(): string {
  return [
    'Eres un asesor pedagógico experto en intervención remedial para colegios chilenos.',
    'Produces un PLAN REMEDIAL POR GRUPO: una secuencia de sesiones para un grupo de',
    'estudiantes que comparte una brecha en un Objetivo de Aprendizaje (OA).',
    '',
    'REGLAS INQUEBRANTABLES:',
    '1. Responde EXCLUSIVAMENTE con un único objeto JSON válido. Sin texto, sin markdown,',
    '   sin comentarios y sin ``` fuera del JSON.',
    '2. Trabajas SOLO con agregados anónimos. NUNCA menciones alumnos por nombre ni',
    '   inventes identidades. La etiqueta del grupo es ABSTRACTA (p.ej. "Grupo de refuerzo',
    '   en comprensión inferencial"), nunca nombres de personas.',
    '3. NO inventes el conteo de alumnos: usa exactamente el "studentCount" provisto.',
    '4. Apégate al OA y al contexto curricular. Escribe en español de Chile.',
    '',
    'El JSON debe tener EXACTAMENTE esta forma:',
    '{',
    '  "groupLabel": string,           // etiqueta abstracta del grupo (sin nombres)',
    '  "studentCount": number,         // == el provisto, sin cambios',
    '  "sharedGap": string,            // la brecha compartida que define el grupo',
    '  "sequence": [                   // al menos 1 paso',
    '    { "order": number, "title": string, "description": string, "linkedNodeId": string|null }',
    '  ],',
    '  "estimatedSessions": number|null',
    '}',
  ].join('\n');
}

function buildUserPrompt(
  ctx: RemedialCurriculumContext,
  aggregates: GroupPlanAggregates,
): string {
  return [
    'Genera el plan remedial por grupo para la siguiente brecha.',
    '',
    'AGREGADOS DETERMINISTAS DEL GRUPO (anónimos, calculados en backend):',
    `- Alumnos bajo umbral (studentCount): ${aggregates.studentCount}`,
    `- Umbral de logro usado: ${aggregates.thresholdPct}%`,
    `- Logro promedio del grupo bajo umbral: ${
      aggregates.averagePct === null ? 'sin datos' : `${aggregates.averagePct}%`
    }`,
    '',
    'CONTEXTO CURRICULAR:',
    renderCurriculumContext(ctx),
    '',
    `Usa exactamente studentCount = ${aggregates.studentCount}. Devuelve solo el JSON del plan.`,
  ].join('\n');
}
