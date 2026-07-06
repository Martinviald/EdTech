/**
 * Versión del prompt/contrato de generación de un TEXTO NUEVO original (Ola 2.2, Opción
 * B). Versión propia (independiente de los prompts de práctica/juez) para que un bump de
 * este modo no invalide la caché de los otros.
 */
export const GENERATE_STIMULUS_PROMPT_VERSION = 'ola2-generate-stimulus-v1';

/** Habilidad/OA objetivo del texto a generar (contenido curricular, sin PII). */
export interface GenerateStimulusSkill {
  name: string;
  code: string | null;
  description: string | null;
}

/** Pasaje fallado usado SOLO como calibración de nivel/estilo (no a copiar). */
export interface GenerateStimulusReference {
  title: string | null;
  text: string;
}

/** Entrada del prompt de generación: target derivado de los fallados + habilidad + refs. */
export interface GenerateStimulusPromptInput {
  textType: string;
  wordTarget: number;
  wordCountRange: [number, number];
  gradeTarget: number | null;
  readabilityTarget: number;
  skill: GenerateStimulusSkill;
  references: GenerateStimulusReference[];
}

// Cota de referencias y de largo por referencia inyectadas al prompt (acota tokens; los
// pasajes fallados llegan ordenados por brecha desc, así que se conservan los más
// relevantes). Es calibración de nivel/estilo, no material a reproducir.
const MAX_REFERENCES = 3;
const REFERENCE_CHAR_CAP = 1800;

/**
 * Construye {system, prompt} para que un modelo fuerte (Pro, feature `remedial_reading`)
 * genere un TEXTO ORIGINAL en español de Chile, de dificultad/largo/tipo parejos a los
 * pasajes fallados, del que se puedan hacer preguntas de la habilidad objetivo. El modelo
 * devuelve un JSON `{ "title": string, "text": string }` (el provider lo valida con Zod).
 *
 * NUNCA recibe PII: la habilidad es curricular (taxonomía) y las referencias son pasajes
 * oficiales (contenido, no datos de alumnos). Las referencias son SOLO calibración: el
 * texto generado debe ser sobre un tema NUEVO, no una copia.
 */
export function buildGenerateStimulusPrompt(input: GenerateStimulusPromptInput): {
  system: string;
  prompt: string;
} {
  return {
    system: buildSystem(input),
    prompt: buildUserPrompt(input),
  };
}

function buildSystem(input: GenerateStimulusPromptInput): string {
  const intro = [
    'Eres un experto en creación de TEXTOS DE LECTURA para colegios chilenos.',
    `Escribes un ÚNICO texto ORIGINAL de tipo ${input.textType}, apropiado para el aula, del`,
    'que un docente pueda construir preguntas de comprensión sobre una habilidad objetivo.',
  ];

  const rules = [
    'REGLAS INQUEBRANTABLES:',
    '1. Responde EXCLUSIVAMENTE con un único objeto JSON válido. Sin texto, sin markdown,',
    '   sin comentarios y sin ``` fuera del JSON.',
    '2. El texto es ORIGINAL y sobre un tema NUEVO: NO copies, parafrasees ni continúes los',
    '   textos de referencia; úsalos solo para calibrar nivel de dificultad, registro y estilo.',
    '3. Ajusta la dificultad al nivel lector objetivo y el largo al rango de palabras indicado.',
    '4. El texto debe permitir preguntas de la HABILIDAD OBJETIVO (comprensión sobre él,',
    '   respondibles desde su contenido). Sé autocontenido: no dependas de conocimiento externo.',
    '5. Escribe en español de Chile, con contenido apropiado para estudiantes.',
    '6. NUNCA incluyas datos personales de alumnos ni de personas reales identificables.',
  ];

  const shape = [
    'El JSON debe tener EXACTAMENTE esta forma:',
    '{',
    '  "title": string,   // título breve del texto',
    '  "text": string     // el texto completo, en párrafos',
    '}',
  ];

  return [...intro, '', ...rules, '', ...shape].join('\n');
}

function buildUserPrompt(input: GenerateStimulusPromptInput): string {
  const [minWords, maxWords] = input.wordCountRange;
  const level =
    input.gradeTarget !== null
      ? `nivel lector ≈ grado ${input.gradeTarget}`
      : 'nivel lector de dificultad media';

  const sections: string[] = [
    `Genera un texto ORIGINAL de tipo ${input.textType}, de aproximadamente ${input.wordTarget} palabras`,
    `(entre ${minWords} y ${maxWords}), con ${level} (índice de legibilidad Fernández-Huerta objetivo ≈ ${input.readabilityTarget}).`,
    '',
    'HABILIDAD OBJETIVO (el texto debe permitir preguntas sobre ella):',
    renderSkill(input.skill),
  ];

  const referenceBlock = renderReferences(input.references);
  if (referenceBlock) {
    sections.push('', referenceBlock);
  }

  sections.push('', 'Devuelve solo el JSON con el título y el texto.');
  return sections.join('\n');
}

function renderSkill(skill: GenerateStimulusSkill): string {
  const code = skill.code ? `${skill.code} — ` : '';
  const description = skill.description ? `: ${skill.description}` : '';
  return `${code}${skill.name}${description}`;
}

/**
 * Renderiza los pasajes fallados como CALIBRACIÓN de nivel/estilo (no a copiar). Devuelve
 * `''` si no hay referencias (→ el prompt se apoya solo en el target numérico). Acota
 * cantidad y largo por referencia para no inflar tokens.
 */
function renderReferences(references: GenerateStimulusReference[]): string {
  const usable = references
    .filter((reference) => reference.text.trim().length > 0)
    .slice(0, MAX_REFERENCES);
  if (usable.length === 0) return '';

  const lines: string[] = [
    'TEXTOS DE REFERENCIA (solo para calibrar nivel/estilo; NO los copies ni continúes, el',
    'tema debe ser NUEVO):',
  ];
  usable.forEach((reference, index) => {
    const title = reference.title ? ` (${reference.title})` : '';
    const text = truncate(reference.text.trim(), REFERENCE_CHAR_CAP);
    lines.push(`${index + 1}.${title}`, '<<<REFERENCIA', text, 'REFERENCIA>>>');
  });
  return lines.join('\n');
}

function truncate(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap).trimEnd()}…`;
}
