import type { AiAnalysisAudience, AiAnalysisSnapshot } from '@soe/types';

/**
 * Versión del prompt/contrato del informe IA de evaluación (F2 S1 — H20.2–H20.5).
 *
 * Se persiste con cada análisis para invalidar caché y auditar regresiones cuando
 * el prompt evolucione. Cambiar el texto del prompt o la forma del output exige
 * bumpear esta versión.
 */
export const PROMPT_VERSION = 's1-insights-v1';

/**
 * Construye el par {system, prompt} del informe IA de evaluación.
 *
 * Principio rector: el snapshot ya trae TODA la psicometría calculada de forma
 * determinista en backend (p, D, punto-biserial, KR-20, distractores, % de logro,
 * cobertura). La IA SOLO interpreta y prioriza; nunca recalcula ni inventa números.
 *
 * El prompt instruye a Gemini para devolver EXACTAMENTE un JSON que cumpla
 * `assessmentInsightsOutputSchema` de `@soe/types` (el runner lo valida con Zod
 * estricto). NUNCA contiene PII: el snapshot llega anonimizado (sin nombres ni RUT).
 *
 * @param snapshot métricas deterministas anonimizadas del instrumento.
 * @param audience audiencia primaria; modula el foco de la narrativa y de las
 *                 recomendaciones (director = gestión/priorización, teacher =
 *                 accionable de aula, general = ambas con foco equilibrado).
 */
export function buildAssessmentInsightsPrompt(
  snapshot: AiAnalysisSnapshot,
  audience: AiAnalysisAudience,
): { system: string; prompt: string } {
  const system = buildSystem();
  const prompt = buildUserPrompt(snapshot, audience);
  return { system, prompt };
}

// ──────────────────────────────────────────────────────────────────────────────
// System: rol, reglas duras y contrato de salida.
// ──────────────────────────────────────────────────────────────────────────────

function buildSystem(): string {
  return [
    'Eres un asesor pedagógico experto en evaluación educativa para colegios chilenos.',
    'Interpretas métricas psicométricas YA CALCULADAS y produces un informe accionable.',
    '',
    'REGLAS INQUEBRANTABLES:',
    '1. Responde EXCLUSIVAMENTE con un único objeto JSON válido. Sin texto, sin markdown,',
    '   sin comentarios y sin ``` fuera del JSON.',
    '2. NO recalcules ni inventes métricas. Usa solo los números del snapshot. Si un dato',
    '   no está (null), refléjalo como null en el output; no lo estimes.',
    '3. NUNCA menciones alumnos por nombre ni inventes identidades: el snapshot está',
    '   anonimizado. Habla siempre en agregados ("el grupo", "N alumnos bajo el umbral").',
    '4. Escribe en español de Chile, claro y profesional, sin jerga estadística innecesaria.',
    '5. Distingue SIEMPRE la causa raíz de un ítem de bajo desempeño:',
    '   - "not_taught": p muy bajo y D positiva razonable, distribución dispersa → contenido',
    '     probablemente no alcanzado a ver/enseñar.',
    '   - "misconception": un distractor concentra muchas respuestas (distractor dominante) →',
    '     error conceptual sistemático; explica la misconcepción que sugiere ese distractor.',
    '   - "item_quality": D baja o negativa, o la clave compite con un distractor → el ÍTEM es',
    '     defectuoso (ambiguo/mal redactado), NO un problema de aprendizaje.',
    '   - "insufficient_practice": p intermedio-bajo con D alta → visto pero poco consolidado.',
    '',
    'CONTRATO DE SALIDA (JSON, claves y tipos EXACTOS):',
    OUTPUT_CONTRACT,
  ].join('\n');
}

/**
 * Descripción textual del schema de salida. Debe permanecer alineada con
 * `assessmentInsightsOutputSchema` de `@soe/types` (el runner valida con Zod).
 */
const OUTPUT_CONTRACT = `{
  "headline": string,                       // titular de una línea, conclusión principal
  "executiveSummary": {
    "director": string,                     // foco gestión y priorización institucional (H20.2)
    "teacher": string                       // foco accionable de aula (H20.2)
  },
  "topItems": [                             // hasta 5 ítems de MEJOR desempeño (H20.3)
    {
      "position": number,                   // nº de pregunta (del snapshot)
      "skillName": string | null,
      "difficulty": number | null,          // p
      "discrimination": number | null,      // D
      "whatWorked": string[],               // por qué funcionó (claridad, alineación al OA…)
      "replicableAction": string            // práctica reutilizable para clases
    }
  ],
  "bottomItems": [                          // hasta 5 ítems de PEOR desempeño (H20.3)
    {
      "position": number,
      "skillName": string | null,
      "difficulty": number | null,          // p
      "likelyCause": "not_taught" | "misconception" | "item_quality" | "insufficient_practice",
      "misconception": string | null,       // inferida del distractor dominante (null si no aplica)
      "actionPlan": string[]                // >=1 paso concreto de remediación
    }
  ],
  "skillGaps": [                            // brechas por habilidad con causa raíz (H20.4)
    {
      "nodeId": string,                     // del snapshot, NO lo inventes
      "nodeName": string,
      "achievement": number | null,         // % de logro
      "rootCauseHypothesis": string,
      "misconceptionSignal": string | null, // desde patrones de distractor
      "reteachStrategy": string,            // estrategia de re-enseñanza
      "exampleActivity": string,            // actividad concreta de aula
      "remedialGroupSize": number           // USA studentsBelowThreshold del snapshot (entero)
    }
  ],
  "recommendations": [                      // priorizadas por audiencia (H20.5)
    {
      "audience": "director" | "teacher",
      "priority": "high" | "medium" | "low", // impacto × factibilidad × persistencia
      "title": string,
      "rationale": string,
      "suggestedActions": string[],
      "linkedSkillIds": string[],           // nodeId del snapshot relacionados
      "linkedItemPositions": number[]       // posiciones de ítems relacionados
    }
  ],
  "reliability": {
    "kr20": number | null,                  // copia el del snapshot (reliability.kr20)
    "interpretation": string                // qué significa esa confiabilidad para leer estos datos
  },
  "confidence": number,                     // 0..1, tu autoevaluación de la solidez del análisis (H20.7)
  "caveats": string[]                       // límites: pocos evaluados, baja cobertura, KR-20 nulo… (H20.7)
}`;

// ──────────────────────────────────────────────────────────────────────────────
// User: el snapshot serializado + instrucciones de priorización por audiencia.
// ──────────────────────────────────────────────────────────────────────────────

function buildUserPrompt(
  snapshot: AiAnalysisSnapshot,
  audience: AiAnalysisAudience,
): string {
  return [
    audienceFocus(audience),
    '',
    'METODOLOGÍA (3 capas):',
    '- Capa 1 — Entrada concreta: Top 5 y Bottom 5 ítems (replicar lo que funciona, diagnosticar lo que falla).',
    '- Capa 2 — Brechas por habilidad con causa raíz: distractor → misconcepción → estrategia + actividad.',
    '- Capa 3 — Recomendaciones priorizadas por impacto × factibilidad × persistencia, enlazadas a',
    '  habilidades (linkedSkillIds) e ítems (linkedItemPositions).',
    '',
    'PRIORIZACIÓN de Top/Bottom: ordena por desempeño (p) y discriminación (D). Si hay menos de 5',
    'ítems disponibles, incluye solo los que existan (no rellenes con inventados).',
    '',
    'Para CADA ítem de bottomItems, decide likelyCause con la regla del system usando p, D,',
    'punto-biserial y el distractor dominante (dominantDistractor vs correctLabel y distribution).',
    '',
    'remedialGroupSize de cada brecha DEBE ser exactamente studentsBelowThreshold de esa habilidad.',
    'reliability.kr20 DEBE ser exactamente reliability.kr20 del snapshot.',
    '',
    'Datos deterministas del instrumento (anonimizados, sin PII):',
    '```json',
    JSON.stringify(serializeSnapshot(snapshot), null, 2),
    '```',
    '',
    'Devuelve AHORA el objeto JSON del informe, y nada más.',
  ].join('\n');
}

/** Instrucción de foco según la audiencia primaria del informe. */
function audienceFocus(audience: AiAnalysisAudience): string {
  switch (audience) {
    case 'director':
      return (
        'AUDIENCIA PRIMARIA: DIRECTIVO. Prioriza la mirada de gestión: priorización de recursos, ' +
        'foco institucional, decisiones macro y seguimiento. Aun así rellena ambos campos de ' +
        'executiveSummary; el de "director" debe ser el más desarrollado y las recomendaciones ' +
        'deben inclinarse a audience="director".'
      );
    case 'teacher':
      return (
        'AUDIENCIA PRIMARIA: PROFESOR. Prioriza lo accionable de aula: qué re-enseñar, cómo y con ' +
        'qué actividad concreta. Aun así rellena ambos campos de executiveSummary; el de "teacher" ' +
        'debe ser el más desarrollado y las recomendaciones deben inclinarse a audience="teacher".'
      );
    case 'general':
    default:
      return (
        'AUDIENCIA: GENERAL (directivos y profesores). Equilibra ambas miradas: rellena por igual ' +
        'executiveSummary.director y executiveSummary.teacher, e incluye recomendaciones para ambas ' +
        'audiencias.'
      );
  }
}

/**
 * Proyecta el snapshot a la forma que ve el modelo. Defensa en profundidad contra
 * PII: solo se exponen agregados y contenido de ítems (stem). No hay campos de
 * alumnos en el tipo, pero serializamos explícitamente para que nunca se filtre
 * algo añadido por error aguas arriba.
 */
function serializeSnapshot(snapshot: AiAnalysisSnapshot) {
  return {
    instrumentName: snapshot.instrumentName,
    gradeName: snapshot.gradeName,
    subjectName: snapshot.subjectName,
    evaluated: snapshot.evaluated,
    enrolled: snapshot.enrolled,
    reliability: { kr20: snapshot.reliability.kr20 },
    items: snapshot.items.map((it) => ({
      position: it.position,
      skillName: it.skillName,
      nodeId: it.nodeId,
      difficulty: it.difficulty,
      discrimination: it.discrimination,
      pointBiserial: it.pointBiserial,
      correctLabel: it.correctLabel,
      dominantDistractor: it.dominantDistractor,
      distribution: it.distribution,
      stem: it.stem,
    })),
    skills: snapshot.skills.map((sk) => ({
      nodeId: sk.nodeId,
      nodeName: sk.nodeName,
      achievement: sk.achievement,
      itemCount: sk.itemCount,
      expectedItemCount: sk.expectedItemCount,
      studentsBelowThreshold: sk.studentsBelowThreshold,
    })),
  };
}
