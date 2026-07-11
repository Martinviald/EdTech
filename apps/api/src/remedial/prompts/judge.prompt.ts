import type { RemedialStimulus } from '@soe/types';

/**
 * Versión del prompt del JUEZ automático de calidad (Ola 2.1b). Un bump invalida la
 * comparabilidad de veredictos entre versiones (no entra en la caché del material,
 * pero sirve de traza en el `qualityReport`/observabilidad).
 */
export const JUDGE_PROMPT_VERSION = 'ola2-judge-v1';

/**
 * Alternativa tal como la ve el JUEZ: SIN `isCorrect` (la clave real nunca llega al
 * LLM). El `RemedialJudgeService` la deriva de la alternativa completa antes de armar
 * el prompt, para el solve-then-check (el service compara la respuesta del juez con la
 * clave real; el juez la deduce a ciegas).
 */
export interface JudgePromptAlternative {
  key: string;
  text: string;
}

/** Pregunta que evalúa el juez: enunciado + alternativas SIN la clave ni la explicación. */
export interface JudgePromptItem {
  stem: string;
  alternatives: JudgePromptAlternative[];
}

/**
 * Construye {system, prompt} para que el juez (Flash) evalúe UN ítem. El juez recibe:
 * - el PASAJE completo (si el set está anclado a un estímulo) — es contenido, no PII;
 * - la PREGUNTA + las alternativas SIN revelar cuál es la correcta ni la explicación
 *   (anti-filtración: el solve-then-check exige que deduzca la clave a ciegas).
 *
 * Pide: (a) responder usando SOLO el texto (o el razonamiento si no hay pasaje) →
 * `derivedAnswer`; (b) `uniqueCorrect` (exactamente una defendible); (c) `factual`
 * (sin errores de hecho en texto/alternativas); (d) `skillMatch` (mide una habilidad
 * de comprensión coherente con el material — aviso blando). El `answerable` NO lo
 * decide el juez: lo calcula el service comparando `derivedAnswer` con la clave real.
 *
 * Anti-sesgo (juez de la misma familia que el generador, ver §5 diseño): se le exige
 * razonar de forma independiente, CITAR el texto para justificar y no dejarse influir
 * por el tono seguro del ítem. El determinismo (temperature 0) lo fija la config del
 * feature `remedial_judge` (`LlmConfigService`).
 */
export function buildJudgePrompt(
  stimulus: RemedialStimulus | null,
  item: JudgePromptItem,
): { system: string; prompt: string } {
  const hasStimulus = Boolean(stimulus?.text?.trim());
  return {
    system: buildSystem(hasStimulus),
    prompt: buildUserPrompt(stimulus, item, hasStimulus),
  };
}

function buildSystem(hasStimulus: boolean): string {
  const intro = [
    'Eres un JUEZ EXPERTO, IMPARCIAL y ESCÉPTICO de ítems de selección múltiple para',
    'colegios chilenos. Tu trabajo es DETECTAR ítems mal construidos, no aprobarlos.',
    'NO asumas que el ítem está bien hecho: examínalo con rigor.',
  ];

  const rules: string[] = [
    'REGLAS INQUEBRANTABLES:',
    '1. Responde EXCLUSIVAMENTE con un único objeto JSON válido. Sin texto, sin markdown,',
    '   sin comentarios y sin ``` fuera del JSON.',
    '2. Razona de forma INDEPENDIENTE. No te dejes influir por el tono seguro o formal del',
    '   ítem: evalúa solo la sustancia.',
  ];
  if (hasStimulus) {
    rules.push(
      '3. RESPONDIBILIDAD: intenta responder la pregunta usando ÚNICAMENTE el TEXTO/PASAJE',
      '   provisto (no uses conocimiento externo). Debes poder CITAR el texto para justificar tu',
      '   elección. Si el texto no permite decidir una única respuesta, "derivedAnswer" es null.',
    );
  } else {
    rules.push(
      '3. RESPONDIBILIDAD: responde la pregunta con razonamiento riguroso a partir de su enunciado',
      '   y alternativas. Si no es posible decidir una única respuesta correcta, "derivedAnswer" es null.',
    );
  }
  rules.push(
    '4. UNICIDAD: evalúa CADA alternativa. Marca "uniqueCorrect" en false si hay CERO o si hay DOS',
    '   O MÁS alternativas defendibles como correctas.',
    hasStimulus
      ? '5. FACTUAL: marca "factual" en false si hay errores de hecho en el TEXTO o en las alternativas.'
      : '5. FACTUAL: marca "factual" en false si hay errores de hecho en el enunciado o en las alternativas.',
    '6. HABILIDAD (aviso blando): marca "skillMatch" en false si el ítem NO mide una habilidad de',
    hasStimulus
      ? '   comprensión lectora anclada al texto (p. ej. se responde sin leerlo, o evalúa trivia ajena).'
      : '   la materia de forma coherente (p. ej. es trivial, ambiguo o evalúa algo ajeno al enunciado).',
    '7. OBJECIONES: en "objections" lista objeciones CONCRETAS y accionables (una por problema).',
    '   Deja "objections" vacío ([]) solo si el ítem es impecable.',
    '8. NUNCA reveles ni asumas cuál alternativa marcó como correcta quien creó el ítem: dedúcelo tú.',
  );

  const shape = [
    'El JSON debe tener EXACTAMENTE esta forma:',
    '{',
    '  "derivedAnswer": string|null,   // la KEY (p. ej. "B") que TÚ elegiste, o null si no se puede',
    '  "uniqueCorrect": boolean,       // hay exactamente UNA alternativa defendible',
    '  "factual": boolean,             // sin errores de hecho',
    '  "skillMatch": boolean,          // mide la habilidad esperada (aviso blando)',
    '  "objections": string[]          // objeciones concretas (vacío si no hay)',
    '}',
  ];

  return [...intro, '', ...rules, '', ...shape].join('\n');
}

function buildUserPrompt(
  stimulus: RemedialStimulus | null,
  item: JudgePromptItem,
  hasStimulus: boolean,
): string {
  const sections: string[] = [];

  if (hasStimulus && stimulus) {
    sections.push(
      'Evalúa la siguiente pregunta usando SOLO este TEXTO/PASAJE:',
      '',
      renderStimulus(stimulus),
      '',
    );
  } else {
    sections.push('Evalúa la siguiente pregunta de selección múltiple:', '');
  }

  sections.push('PREGUNTA:', item.stem, '', 'ALTERNATIVAS (no sabes cuál marcó el autor como correcta):');
  for (const alt of item.alternatives) {
    sections.push(`${alt.key}) ${alt.text}`);
  }

  sections.push('', 'Devuelve solo el JSON del veredicto.');
  return sections.join('\n');
}

/** Renderiza el TEXTO COMPLETO del pasaje (contenido curricular, no PII). */
function renderStimulus(stimulus: RemedialStimulus): string {
  const lines: string[] = [];
  if (stimulus.title) lines.push(`Título: ${stimulus.title}`);
  lines.push('<<<PASAJE', (stimulus.text ?? '').trim(), 'PASAJE>>>');
  return lines.join('\n');
}
