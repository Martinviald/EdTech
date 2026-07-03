import type { RemedialBrief } from '../remedial-brief.service';
import type {
  RemedialCurriculumContext,
  RemedialReferenceItem,
} from '../remedial-context.service';
import { renderCurriculumContext } from './curriculum-context.prompt';

/**
 * Versión del prompt/contrato del set de ítems de práctica.
 * `ola1-practice-v2`: ancla la generación a la evidencia del error (brief G4) e
 * inyecta ítems de referencia COMPLETOS (alternativas + clave + explicación, G5).
 */
export const PRACTICE_PROMPT_VERSION = 'ola1-practice-v2';

/**
 * Construye {system, prompt} para generar N ítems de práctica de selección
 * múltiple sobre la habilidad débil. El modelo devuelve un JSON con un arreglo de
 * ítems (el generador valida cada `content` con `validateItemContent`). RAG: el
 * contexto curricular + los ítems de referencia completos anclan nivel/estilo y el
 * `brief` (opcional) ancla las alternativas incorrectas a la evidencia real del
 * error. NUNCA recibe PII (el brief usa el snapshot, que ya es PII-free).
 */
export function buildPracticePrompt(
  ctx: RemedialCurriculumContext,
  itemCount: number,
  brief?: RemedialBrief | null,
): { system: string; prompt: string } {
  return {
    system: buildSystem(itemCount),
    prompt: buildUserPrompt(ctx, itemCount, brief),
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
    '4. ANCLA AL ERROR REAL: cuando se te entregue evidencia del error (distractor',
    '   dominante y misconception), diseña las alternativas INCORRECTAS para que capturen',
    '   ese error concreto —así el ítem discrimina exactamente la brecha detectada—.',
    '5. NUNCA incluyas datos de alumnos. Los ítems son genéricos.',
    '6. Escribe en español de Chile.',
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
  brief?: RemedialBrief | null,
): string {
  const sections: string[] = [
    `Genera ${itemCount} ítems de práctica para la siguiente brecha, usando este contexto curricular:`,
    '',
    renderCurriculumContext(ctx),
  ];

  const referenceBlock = renderReferenceItems(ctx.referenceItems);
  if (referenceBlock) {
    sections.push('', referenceBlock);
  }

  const briefBlock = renderBrief(brief);
  if (briefBlock) {
    sections.push('', briefBlock);
  }

  sections.push('', 'Devuelve solo el JSON del set de ítems.');
  return sections.join('\n');
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
