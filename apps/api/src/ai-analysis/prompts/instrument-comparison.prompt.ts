import type { AiAnalysisAudience, ComparisonSide, InstrumentComparisonSnapshot } from '@soe/types';

/**
 * Versión del prompt/contrato del diagnóstico de comparación de instrumentos
 * (TKT-23). Se persiste con cada análisis para invalidar caché y auditar
 * regresiones. Cambiar el texto del prompt o la forma del output exige bumpear.
 */
export const PROMPT_VERSION = 'tkt23-instrument-comparison-v1';

/**
 * Construye el par {system, prompt} del diagnóstico de variación entre dos
 * instrumentos comparables.
 *
 * Principio rector: el snapshot ya trae, de forma DETERMINISTA y anonimizada, el
 * contenido (enunciados, alternativas, pasajes) y los resultados (% de logro por
 * ítem/habilidad, distribución, p, D) de AMBOS instrumentos. La IA SOLO
 * interpreta y PROPONE hipótesis de por qué variaron los resultados; nunca
 * recalcula ni inventa números. Es una hipótesis a validar por el humano.
 *
 * El prompt instruye al modelo a devolver EXACTAMENTE un JSON que cumpla
 * `instrumentComparisonOutputSchema` de `@soe/types` (el runner lo valida con Zod
 * estricto). NUNCA contiene PII: el snapshot llega anonimizado.
 */
export function buildInstrumentComparisonPrompt(
  snapshot: InstrumentComparisonSnapshot,
  audience: AiAnalysisAudience,
): { system: string; prompt: string } {
  return { system: buildSystem(), prompt: buildUserPrompt(snapshot, audience) };
}

// ── System: rol, reglas duras y contrato de salida ──────────────────────────

function buildSystem(): string {
  return [
    'Eres un asesor pedagógico experto en evaluación educativa para colegios chilenos.',
    'Tu tarea: DIAGNOSTICAR por qué el resultado (% de logro) varió entre DOS instrumentos',
    'comparables (p. ej. el mismo diagnóstico aplicado en dos años). Analizas tanto el',
    'CONTENIDO (enunciados, alternativas, pasajes, cobertura de habilidades) como los',
    'RESULTADOS (dificultad p, discriminación D, distribución de respuestas, % de logro).',
    '',
    'REGLAS INQUEBRANTABLES:',
    '1. Responde EXCLUSIVAMENTE con un único objeto JSON válido. Sin texto, sin markdown,',
    '   sin comentarios y sin ``` fuera del JSON.',
    '2. NO recalcules ni inventes métricas. Usa solo los números del snapshot. Si un dato',
    '   no está (null), refléjalo como null; no lo estimes.',
    '3. Tu salida es una HIPÓTESIS a validar por un humano, NO una conclusión definitiva.',
    '   Sé explícito sobre la incertidumbre en `confidence` y `caveats`.',
    '4. NUNCA menciones alumnos por nombre: el snapshot está anonimizado. Habla en agregados.',
    '5. Distingue causas de contenido de causas de aprendizaje: un cambio de resultados puede',
    '   deberse a que el instrumento cambió (ítems más difíciles, textos más largos, otra',
    '   cobertura, distractores más potentes) O a un cambio real en el aprendizaje del grupo.',
    '   Cuando el contenido difiera de forma relevante, dilo; cuando el contenido sea',
    '   equivalente y aun así el resultado cambie, atribúyelo al aprendizaje/enseñanza.',
    '6. Compara habilidad por habilidad usando los nodeName; solo cruza habilidades que',
    '   existan en ambos lados. Escribe en español de Chile, claro y profesional.',
    '',
    'CONTRATO DE SALIDA (JSON, claves y tipos EXACTOS):',
    OUTPUT_CONTRACT,
  ].join('\n');
}

const OUTPUT_CONTRACT = `{
  "headline": string,                          // conclusión principal en una línea
  "overallVariation": {
    "baseAchievement": number | null,          // % de logro global del lado BASE (del snapshot)
    "comparisonAchievement": number | null,    // % de logro global del lado COMPARADO (del snapshot)
    "deltaPct": number | null,                 // comparison - base (puntos porcentuales)
    "direction": "improved" | "declined" | "stable",
    "magnitude": string                        // lectura cualitativa de la magnitud del cambio
  },
  "contentDifferences": [                       // qué cambió en el CONTENIDO/dificultad entre instrumentos
    {
      "aspect": string,                         // p. ej. "dificultad de los textos", "cobertura de habilidad X"
      "description": string,
      "evidence": string                        // referencia a ítems (posición), habilidades o pasajes del snapshot
    }
  ],
  "skillMovements": [                           // habilidades que se movieron entre ambos lados
    {
      "nodeName": string,                       // del snapshot; solo habilidades presentes en AMBOS lados
      "baseAchievement": number | null,         // % del lado base
      "comparisonAchievement": number | null,   // % del lado comparado
      "deltaPct": number | null,                // comparison - base
      "interpretation": string
    }
  ],
  "hypotheses": [                               // >=1: POR QUÉ variaron los resultados (el corazón del diagnóstico)
    {
      "hypothesis": string,
      "supportingEvidence": string[],           // señales concretas del snapshot que la sostienen
      "relatedSkills": string[],                // nodeName de habilidades relacionadas
      "likelihood": "high" | "medium" | "low"
    }
  ],
  "recommendations": [
    {
      "audience": "director" | "teacher",
      "priority": "high" | "medium" | "low",
      "title": string,
      "rationale": string,
      "suggestedActions": string[]
    }
  ],
  "confidence": number,                         // 0..1, autoevaluación de la solidez del diagnóstico
  "caveats": string[]                           // límites: pocos evaluados, baja cobertura, instrumentos no del todo equivalentes…
}`;

// ── User: los dos snapshots serializados + foco por audiencia ────────────────

function buildUserPrompt(
  snapshot: InstrumentComparisonSnapshot,
  audience: AiAnalysisAudience,
): string {
  return [
    audienceFocus(audience),
    '',
    'METODOLOGÍA:',
    '1. Cuantifica la variación global (overallVariation) usando averageAchievement de cada lado.',
    '   deltaPct = comparison.averageAchievement - base.averageAchievement.',
    '2. Contrasta el CONTENIDO: dificultad (p), discriminación (D), distribución/distractores,',
    '   enunciados, alternativas y pasajes. Identifica diferencias relevantes (contentDifferences).',
    '3. Cruza las habilidades por nodeName presentes en ambos lados (skillMovements).',
    '4. Formula hipótesis priorizadas de por qué cambió el resultado, separando causas de',
    '   contenido/instrumento de causas de aprendizaje/enseñanza.',
    '5. Cierra con recomendaciones accionables y una autoevaluación honesta (confidence/caveats).',
    '',
    'IMPORTANTE: el lado "base" es la referencia (típicamente el instrumento/año anterior) y',
    '"comparison" es el que se contrasta. Un deltaPct positivo = mejora; negativo = caída.',
    '',
    'Datos deterministas de AMBOS instrumentos (anonimizados, sin PII):',
    '```json',
    JSON.stringify(
      {
        base: serializeSide(snapshot.base),
        comparison: serializeSide(snapshot.comparison),
      },
      null,
      2,
    ),
    '```',
    '',
    'Devuelve AHORA el objeto JSON del diagnóstico, y nada más.',
  ].join('\n');
}

function audienceFocus(audience: AiAnalysisAudience): string {
  switch (audience) {
    case 'director':
      return (
        'AUDIENCIA PRIMARIA: DIRECTIVO. Prioriza la mirada de gestión: qué significa la variación ' +
        'para la toma de decisiones institucionales y la priorización de recursos. Las ' +
        'recomendaciones deben inclinarse a audience="director".'
      );
    case 'teacher':
      return (
        'AUDIENCIA PRIMARIA: PROFESOR. Prioriza lo accionable de aula: qué re-enseñar y cómo, a la ' +
        'luz de la variación entre instrumentos. Las recomendaciones deben inclinarse a ' +
        'audience="teacher".'
      );
    case 'general':
    default:
      return (
        'AUDIENCIA: GENERAL (directivos y profesores). Equilibra ambas miradas e incluye ' +
        'recomendaciones para ambas audiencias.'
      );
  }
}

/** Proyecta un lado a la forma que ve el modelo (defensa en profundidad anti-PII). */
function serializeSide(side: ComparisonSide) {
  return {
    instrumentName: side.instrumentName,
    instrumentType: side.instrumentType,
    year: side.year,
    gradeName: side.gradeName,
    subjectName: side.subjectName,
    studentsEvaluated: side.studentsEvaluated,
    studentsEnrolled: side.studentsEnrolled,
    averageAchievement: side.averageAchievement,
    reliabilityKr20: side.reliabilityKr20,
    items: side.items.map((it) => ({
      position: it.position,
      skillName: it.skillName,
      stem: it.stem,
      alternatives: it.alternatives,
      difficulty: it.difficulty,
      discrimination: it.discrimination,
      correctLabel: it.correctLabel,
      dominantDistractor: it.dominantDistractor,
      distribution: it.distribution,
      passageTitle: it.passageTitle,
    })),
    skills: side.skills.map((s) => ({
      nodeName: s.nodeName,
      achievement: s.achievement,
      itemCount: s.itemCount,
    })),
    passages: side.passages,
  };
}
