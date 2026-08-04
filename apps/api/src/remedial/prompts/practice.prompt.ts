import type { RemedialStimulus } from '@soe/types';
import type { RemedialBrief } from '../remedial-brief.service';
import type {
  RemedialCurriculumContext,
  RemedialReferenceItem,
} from '../remedial-context.service';
import { renderCurriculumContext } from './curriculum-context.prompt';

/**
 * Versión del prompt/contrato del set de ítems de práctica SELF-CONTAINED (sin
 * estímulo). `ola1-practice-v2`: ancla la generación a la evidencia del error
 * (brief G4) e inyecta ítems de referencia COMPLETOS (alternativas + clave +
 * explicación, G5).
 */
export const PRACTICE_PROMPT_VERSION = 'ola1-practice-v2';

/**
 * Versión del prompt del set ANCLADO a un estímulo (Opción A · Ola 2.1a). El prompt
 * inyecta el TEXTO COMPLETO del pasaje e instruye que las preguntas sean respondibles
 * SOLO desde él. Versión aparte de `PRACTICE_PROMPT_VERSION` para que un bump del
 * modo con estímulo no invalide la caché del modo self_contained (y viceversa).
 */
export const PRACTICE_STIMULUS_PROMPT_VERSION = 'ola2-practice-stimulus-v1';

/**
 * Construye {system, prompt} para generar N ítems de práctica de selección
 * múltiple sobre la habilidad débil. El modelo devuelve un JSON con un arreglo de
 * ítems (el generador valida cada `content` con `validateItemContent`). RAG: el
 * contexto curricular + los ítems de referencia completos anclan nivel/estilo y el
 * `brief` (opcional) ancla las alternativas incorrectas a la evidencia real del
 * error. NUNCA recibe PII (el brief usa el snapshot, que ya es PII-free).
 *
 * `stimulus` (opcional · Ola 2.1a): con pasaje, el prompt incluye su texto completo
 * e instruye que cada ítem sea RESPONDIBLE SOLO desde él (Opción A). El pasaje es
 * contenido curricular, no PII.
 *
 * `feedback` (opcional · Ola 2.1b, modo regeneración): objeciones concretas del juez
 * de la ronda anterior. Cuando viene no vacío, el prompt agrega un bloque "EVITA ESTOS
 * PROBLEMAS DETECTADOS" para que la regeneración corrija lo objetado. `undefined`/`[]`
 * → prompt idéntico a la ronda 0 (no invalida la caché ni la versión).
 */
export function buildPracticePrompt(
  ctx: RemedialCurriculumContext,
  itemCount: number,
  brief?: RemedialBrief | null,
  stimulus?: RemedialStimulus | null,
  feedback?: string[],
): { system: string; prompt: string } {
  return {
    system: buildSystem(itemCount, Boolean(stimulus)),
    prompt: buildUserPrompt(ctx, itemCount, brief, stimulus ?? null, feedback),
  };
}

function buildSystem(itemCount: number, hasStimulus: boolean): string {
  const intro = hasStimulus
    ? [
        'Eres un experto en construcción de ítems de COMPRENSIÓN LECTORA para colegios chilenos.',
        `Generas EXACTAMENTE ${itemCount} ítems de práctica de selección múltiple ANCLADOS a un`,
        'TEXTO/PASAJE oficial que se te entrega, para reforzar una habilidad débil sobre un OA.',
      ]
    : [
        'Eres un experto en construcción de ítems de evaluación para colegios chilenos.',
        `Generas EXACTAMENTE ${itemCount} ítems de práctica de selección múltiple para`,
        'reforzar una habilidad débil sobre un Objetivo de Aprendizaje (OA).',
      ];

  const rules: string[] = [
    'REGLAS INQUEBRANTABLES:',
    '1. Responde EXCLUSIVAMENTE con un único objeto JSON válido. Sin texto, sin markdown,',
    '   sin comentarios y sin ``` fuera del JSON.',
  ];
  if (hasStimulus) {
    rules.push(
      '2. ANCLAJE AL TEXTO: cada ítem debe ser RESPONDIBLE ÚNICAMENTE a partir del TEXTO/PASAJE',
      '   provisto. NO dependas de conocimiento externo ni inventes datos que no estén en el texto;',
      '   la clave correcta y el descarte de cada distractor deben poder justificarse CITANDO el texto.',
    );
  } else {
    rules.push(
      '2. Cada ítem evalúa el OA provisto. Usa el contexto curricular y los ítems de',
      '   referencia para calibrar nivel y estilo. NO inventes contenido fuera del OA.',
    );
  }
  rules.push(
    '3. Cada ítem es de selección múltiple con 4 alternativas; EXACTAMENTE UNA correcta.',
    '4. ANCLA AL ERROR REAL: cuando se te entregue evidencia del error (distractor',
    '   dominante y misconception), diseña las alternativas INCORRECTAS para que capturen',
    '   ese error concreto —así el ítem discrimina exactamente la brecha detectada—.',
    '5. NUNCA incluyas datos de alumnos. Los ítems son genéricos.',
    '6. Escribe en español de Chile.',
  );

  const shape = [
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
  ];

  return [...intro, '', ...rules, '', ...shape].join('\n');
}

function buildUserPrompt(
  ctx: RemedialCurriculumContext,
  itemCount: number,
  brief?: RemedialBrief | null,
  stimulus?: RemedialStimulus | null,
  feedback?: string[],
): string {
  const sections: string[] = [];

  const stimulusBlock = renderStimulus(stimulus);
  if (stimulusBlock) {
    sections.push(
      `Genera ${itemCount} ítems de práctica RESPONDIBLES SOLO desde el siguiente TEXTO/PASAJE oficial.`,
      '',
      stimulusBlock,
      '',
      'Usa además este contexto curricular para calibrar nivel y estilo (sin salirte del texto):',
      '',
      renderCurriculumContext(ctx),
    );
  } else {
    sections.push(
      `Genera ${itemCount} ítems de práctica para la siguiente brecha, usando este contexto curricular:`,
      '',
      renderCurriculumContext(ctx),
    );
  }

  const referenceBlock = renderReferenceItems(ctx.referenceItems);
  if (referenceBlock) {
    sections.push('', referenceBlock);
  }

  const briefBlock = renderBrief(brief);
  if (briefBlock) {
    sections.push('', briefBlock);
  }

  // Ola 2.1b (regeneración): objeciones del juez de la ronda anterior. Va al final,
  // como restricción dura sobre el set regenerado.
  const feedbackBlock = renderFeedback(feedback);
  if (feedbackBlock) {
    sections.push('', feedbackBlock);
  }

  sections.push('', 'Devuelve solo el JSON del set de ítems.');
  return sections.join('\n');
}

/**
 * Renderiza las objeciones del juez (Ola 2.1b) como restricciones a evitar en la
 * regeneración. Devuelve `''` si no hay feedback (ronda 0 → prompt sin este bloque,
 * idéntico al histórico). Las objeciones son sobre el CONTENIDO del ítem (no PII).
 */
function renderFeedback(feedback?: string[]): string {
  const objections = (feedback ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
  if (objections.length === 0) return '';

  const lines: string[] = [
    'EVITA ESTOS PROBLEMAS DETECTADOS por el juez en la ronda anterior (corrígelos en TODOS los ítems nuevos):',
  ];
  objections.forEach((objection, idx) => {
    lines.push(`${idx + 1}. ${objection}`);
  });
  lines.push(
    'INSTRUCCIÓN: cada ítem nuevo debe ser respondible desde el material, tener EXACTAMENTE una alternativa correcta y no contener errores de hecho.',
  );
  return lines.join('\n');
}

/**
 * Renderiza el TEXTO COMPLETO del estímulo (pasaje oficial) para anclar las
 * preguntas. Devuelve `''` si no hay pasaje o su texto es vacío (→ modo
 * self_contained). El pasaje es contenido curricular, no PII.
 */
function renderStimulus(stimulus?: RemedialStimulus | null): string {
  const text = stimulus?.text?.trim();
  if (!stimulus || !text) return '';

  const lines: string[] = [
    'TEXTO / PASAJE OFICIAL (ancla las preguntas EXCLUSIVAMENTE a este texto):',
  ];
  if (stimulus.title) lines.push(`Título: ${stimulus.title}`);
  lines.push('<<<PASAJE', text, 'PASAJE>>>');
  return lines.join('\n');
}

/**
 * Renderiza los ítems de referencia COMPLETOS (enunciado + alternativas + clave +
 * explicación) como molde de estilo/nivel/formato. Devuelve `''` si no hay ninguno.
 */
function renderReferenceItems(referenceItems?: RemedialReferenceItem[]): string {
  if (!referenceItems || referenceItems.length === 0) return '';

  const lines: string[] = [
    'ÍTEMS DE REFERENCIA COMPLETOS (molde de estilo, nivel y formato de alternativas; NO los copies literalmente):',
  ];
  referenceItems.forEach((item, idx) => {
    lines.push(`${idx + 1}. [${item.type}] (procedencia: ${item.fromNode})`);
    lines.push(`   Enunciado: ${item.stem}`);
    if (item.alternatives && item.alternatives.length > 0) {
      lines.push('   Alternativas:');
      for (const alt of item.alternatives) {
        const mark = alt.isCorrect ? ' (correcta)' : '';
        lines.push(`     ${alt.key}) ${alt.text}${mark}`);
      }
    }
    if (item.correctKey) lines.push(`   Clave: ${item.correctKey}`);
    if (item.explanation) lines.push(`   Explicación: ${item.explanation}`);
  });
  return lines.join('\n');
}

/**
 * Renderiza el brief del error (G4): causa raíz + misconception + estrategia +
 * evidencia de los distractores realmente elegidos. Es la instrucción de anclaje al
 * error. Devuelve `''` si no hay brief (degradación → solo contexto curricular).
 */
function renderBrief(brief?: RemedialBrief | null): string {
  if (!brief) return '';

  const lines: string[] = ['EVIDENCIA DEL ERROR REAL A ATACAR (ancla aquí las alternativas incorrectas):'];
  if (brief.rootCauseHypothesis) lines.push(`- Causa raíz: ${brief.rootCauseHypothesis}`);
  if (brief.misconceptionSignal) lines.push(`- Señal de misconception: ${brief.misconceptionSignal}`);
  if (brief.reteachStrategy) lines.push(`- Estrategia de reenseñanza: ${brief.reteachStrategy}`);
  if (brief.achievement !== null) {
    lines.push(`- Logro del grupo en la habilidad: ${brief.achievement}%`);
  }

  const errorsWithSignal = brief.realErrors.filter(
    (err) => err.dominantDistractor || err.stem,
  );
  if (errorsWithSignal.length > 0) {
    lines.push('Errores reales observados (usa el distractor dominante como base de una alternativa incorrecta):');
    errorsWithSignal.forEach((err, idx) => {
      lines.push(`${idx + 1}. Enunciado: ${err.stem ?? '(sin enunciado)'}`);
      if (err.correctLabel) lines.push(`   Clave correcta: ${err.correctLabel}`);
      if (err.dominantDistractor) {
        lines.push(`   Distractor dominante (el más elegido, incorrecto): ${err.dominantDistractor}`);
      }
      const dist = Object.entries(err.distribution);
      if (dist.length > 0) {
        const rendered = dist.map(([label, count]) => `${label}=${count}`).join(', ');
        lines.push(`   Distribución de respuestas: ${rendered}`);
      }
    });
  }

  lines.push(
    'INSTRUCCIÓN: al menos una alternativa incorrecta de tus ítems debe reflejar el error del distractor dominante / la misconception, para que el ítem discrimine esa brecha.',
  );
  return lines.join('\n');
}
