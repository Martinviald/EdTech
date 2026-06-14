import type { AiAnalysisAudience, ItemInsightSnapshot } from '@soe/types';

/**
 * Versión del prompt/contrato del análisis IA POR-PREGUNTA (F2 S2 — H20.8).
 *
 * Se persiste con cada análisis para invalidar caché y auditar regresiones cuando
 * el prompt evolucione. Cambiar el texto del prompt o la forma del output exige
 * bumpear esta versión.
 */
export const ITEM_INSIGHT_PROMPT_VERSION = 's2-item-insight-v1';

/**
 * Construye el par {system, prompt} del análisis IA por-pregunta (drill-down).
 *
 * Principio rector (CLAUDE.md §8.3): el snapshot ya trae TODA la psicometría
 * calculada de forma determinista en backend (p, D, punto-biserial, distribución
 * de alternativas, distractor dominante). La IA SOLO interpreta el porqué del
 * resultado, lee distractores/pasaje/imagen y propone acciones; nunca recalcula
 * ni inventa números.
 *
 * Devuelve EXACTAMENTE un JSON que cumpla `itemInsightOutputSchema` de `@soe/types`
 * (el runner lo valida con Zod estricto). NUNCA contiene PII: el snapshot llega
 * anonimizado (sin nombres ni RUT). Las imágenes, si existen, se envían aparte por
 * el canal multimodal (`completeMultimodal`); este prompt describe que están.
 *
 * @param snapshot métricas + contenido deterministas de la pregunta (sin PII).
 * @param audience audiencia primaria; modula el foco de las acciones.
 */
export function buildItemInsightPrompt(
  snapshot: ItemInsightSnapshot,
  audience: AiAnalysisAudience,
): { system: string; prompt: string } {
  return {
    system: buildSystem(),
    prompt: buildUserPrompt(snapshot, audience),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// System: rol, reglas duras y contrato de salida.
// ──────────────────────────────────────────────────────────────────────────────

function buildSystem(): string {
  return [
    'Eres un asesor pedagógico experto en evaluación educativa para colegios chilenos.',
    'Analizas UNA pregunta de selección múltiple e interpretas métricas YA CALCULADAS.',
    '',
    'REGLAS INQUEBRANTABLES:',
    '1. Responde EXCLUSIVAMENTE con un único objeto JSON válido. Sin texto, sin markdown,',
    '   sin comentarios y sin ``` fuera del JSON.',
    '2. NO recalcules ni inventes métricas. Usa solo los números del snapshot. Si un dato',
    '   no está (null), refléjalo como null en el output; no lo estimes.',
    '3. NUNCA menciones alumnos por nombre ni inventes identidades: el snapshot está',
    '   anonimizado. Habla siempre en agregados ("el grupo", "N alumnos eligieron…").',
    '4. Escribe en español de Chile, claro y profesional, sin jerga estadística innecesaria.',
    '5. Decide likelyCause (causa del desempeño) con esta regla:',
    '   - "not_taught": p (difficulty) muy bajo y distribución dispersa → contenido',
    '     probablemente no alcanzado a ver/enseñar.',
    '   - "misconception": un distractor concentra muchas respuestas (dominantDistractor) →',
    '     error conceptual sistemático; explica la misconcepción que sugiere ese distractor.',
    '   - "item_quality": discrimination (D) baja o negativa, punto-biserial <0.10, o la',
    '     clave compite con un distractor → el ÍTEM es defectuoso (ambiguo/mal redactado).',
    '   - "insufficient_practice": p intermedio-bajo con D razonable → visto pero poco consolidado.',
    '6. itemQuality.verdict: "solid" (mide bien), "review" (señales que ameritan revisión),',
    '   "flawed" (probablemente defectuoso).',
    '7. distractorAnalysis: una lectura por cada distractor relevante (los más elegidos):',
    '   qué error/misconcepción revela elegir esa alternativa.',
    '8. passageInsight: si el snapshot trae "passage", explica cómo influye en la pregunta;',
    '   si no hay pasaje, devuelve null. visualInsight: si se adjuntó una imagen (el snapshot',
    '   lista "images" y la imagen va en el contenido multimodal), descríbela e interprétala;',
    '   si no hay imagen, devuelve null. NO afirmes ver una imagen que no se adjuntó.',
    '',
    'CONTRATO DE SALIDA (JSON, claves y tipos EXACTOS):',
    OUTPUT_CONTRACT,
  ].join('\n');
}

/**
 * Descripción textual del schema de salida. Debe permanecer alineada con
 * `itemInsightOutputSchema` de `@soe/types` (el runner valida con Zod).
 */
const OUTPUT_CONTRACT = `{
  "headline": string,                       // titular de una línea del análisis de la pregunta
  "performanceSummary": string,             // por qué se obtuvo ese resultado en su contexto
  "likelyCause": "not_taught" | "misconception" | "item_quality" | "insufficient_practice",
  "misconception": string | null,           // inferida del distractor dominante (null si no aplica)
  "distractorAnalysis": [                    // lectura de los distractores relevantes
    { "key": string, "interpretation": string }
  ],
  "passageInsight": string | null,          // cómo el pasaje asociado influye (null si no hay pasaje)
  "visualInsight": string | null,           // lectura de la imagen adjunta (null si no se adjuntó imagen)
  "itemQuality": {
    "verdict": "solid" | "review" | "flawed",
    "notes": string
  },
  "recommendedActions": string[],           // >=1 acción concreta (remediar / replicar / revisar el ítem)
  "confidence": number,                     // 0..1, tu autoevaluación de la solidez del análisis
  "caveats": string[]                       // límites (muestra chica, sin imagen, etc.)
}`;

// ──────────────────────────────────────────────────────────────────────────────
// User: el snapshot serializado + foco por audiencia.
// ──────────────────────────────────────────────────────────────────────────────

function buildUserPrompt(
  snapshot: ItemInsightSnapshot,
  audience: AiAnalysisAudience,
): string {
  const hasImages = snapshot.images.length > 0;
  return [
    audienceFocus(audience),
    '',
    'Analiza la siguiente pregunta. Usa la distribución de alternativas y el distractor',
    'dominante para inferir la causa del desempeño y las misconcepciones del grupo.',
    '',
    hasImages
      ? `NOTA: se adjuntaron ${snapshot.images.length} imagen(es) en el contenido multimodal. Interprétalas en visualInsight.`
      : 'NOTA: no se adjuntó ninguna imagen. visualInsight DEBE ser null.',
    snapshot.passage
      ? 'NOTA: la pregunta tiene un pasaje asociado (campo "passage"). Considéralo en passageInsight.'
      : 'NOTA: la pregunta no tiene pasaje. passageInsight DEBE ser null.',
    '',
    'Datos deterministas de la pregunta (anonimizados, sin PII):',
    '```json',
    JSON.stringify(serializeSnapshot(snapshot), null, 2),
    '```',
    '',
    'Devuelve AHORA el objeto JSON del análisis, y nada más.',
  ].join('\n');
}

/** Instrucción de foco según la audiencia primaria del análisis. */
function audienceFocus(audience: AiAnalysisAudience): string {
  switch (audience) {
    case 'director':
      return (
        'AUDIENCIA PRIMARIA: DIRECTIVO. Enfoca recommendedActions en la mirada de gestión: ' +
        'qué implica este ítem para la priorización y el seguimiento institucional.'
      );
    case 'teacher':
      return (
        'AUDIENCIA PRIMARIA: PROFESOR. Enfoca recommendedActions en lo accionable de aula: ' +
        'qué re-enseñar o cómo replicar, con pasos concretos.'
      );
    case 'general':
    default:
      return (
        'AUDIENCIA: GENERAL (directivos y profesores). Equilibra acciones de gestión y de aula ' +
        'en recommendedActions.'
      );
  }
}

/**
 * Proyecta el snapshot a la forma que ve el modelo. Defensa en profundidad contra
 * PII: solo se exponen agregados y contenido del ítem. El base64 de las imágenes
 * NO se incluye aquí (va por el canal multimodal); solo su metadata descriptiva.
 */
function serializeSnapshot(snapshot: ItemInsightSnapshot) {
  return {
    position: snapshot.position,
    instrumentName: snapshot.instrumentName,
    type: snapshot.type,
    stem: snapshot.stem,
    correctKey: snapshot.correctKey,
    alternatives: snapshot.alternatives.map((alt) => ({
      key: alt.key,
      text: alt.text,
      isCorrect: alt.isCorrect,
      count: alt.count,
      percentage: alt.percentage,
    })),
    totalResponses: snapshot.totalResponses,
    blankCount: snapshot.blankCount,
    correctRate: snapshot.correctRate,
    difficulty: snapshot.difficulty,
    discrimination: snapshot.discrimination,
    pointBiserial: snapshot.pointBiserial,
    dominantDistractor: snapshot.dominantDistractor,
    skillName: snapshot.skillName,
    contentName: snapshot.contentName,
    tags: snapshot.tags,
    passage: snapshot.passage,
    images: snapshot.images.map((img) => ({
      mimeType: img.mimeType,
      note: img.note,
      source: img.source,
    })),
  };
}
