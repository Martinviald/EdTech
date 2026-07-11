// TKT-03 — Mapeo código de nodo → etiqueta legible, en el punto de PRESENTACIÓN.
//
// No altera los datos ni los códigos de la taxonomía: solo traduce el `code`
// técnico del nodo a una forma amigable para el usuario. La lógica se deriva del
// formato de código de la taxonomía:
//   - Objetivo de aprendizaje: `{SUBJ}-{grado}-OA{NN}`  (ej. `LANG-1B-OA12`)
//   - Habilidad:               `{SUBJ}-SK-{SLUG}`         (ej. `LANG-SK-LOCALIZAR`)
//   - Tipo de texto:           `{SUBJ}-TT-{SLUG}`         (ej. `LANG-TT-POEMA`)
//   - Asignatura pura:         `LANG` | `MATH` | …
//
// El tipo `QuestionTaxonomyTag`/`ItemTaxonomyTagModel` solo expone `nodeCode` y
// `nodeType` (sin subjectCode ni shortName), por eso la asignatura y el número de
// OA se derivan del propio código.
//
// (Podría promoverse a `packages/types` si el backend necesitara la misma lógica;
// por ahora es una utilidad de presentación exclusiva del frontend.)

/** Nombre humano de la asignatura por su código MINEDUC. Espeja `subjects` del seed. */
const SUBJECT_LABELS: Record<string, string> = {
  LANG: 'Lenguaje',
  MATH: 'Matemáticas',
  SCI: 'Ciencias',
  HIST: 'Historia',
  ENG: 'Inglés',
};

/** Etiqueta legible (singular) por tipo de nodo de taxonomía. */
const NODE_TYPE_LABELS: Record<string, string> = {
  skill: 'Habilidad',
  content: 'Contenido',
  learning_objective: 'Objetivo de aprendizaje',
  text_type: 'Tipo de texto',
  axis: 'Eje',
  domain: 'Dominio',
  subdomain: 'Subdominio',
  performance_level: 'Nivel de desempeño',
  descriptor: 'Descriptor',
  criterion: 'Criterio',
  paper: 'Paper',
};

/** Nombre legible de la asignatura a partir de su código (LANG → "Lenguaje"). */
export function subjectLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return SUBJECT_LABELS[code.toUpperCase()] ?? null;
}

/** Etiqueta legible del tipo de nodo (skill → "Habilidad"). Devuelve el tipo crudo si no se conoce. */
export function nodeTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return NODE_TYPE_LABELS[type] ?? type;
}

/**
 * Código de nodo en forma legible para mostrar junto al nombre del nodo.
 *   - Objetivo de aprendizaje → `"OA-{n}"` (sin cero a la izquierda ni prefijo).
 *   - Asignatura pura (LANG/MATH/…) → el nombre de la asignatura.
 *   - Cualquier otro código técnico (SK-, TT-, CUR-, DIA-, descriptor…) → `null`,
 *     para no mostrar el código crudo (basta el nombre humano del nodo).
 */
export function formatNodeCode(
  code: string | null | undefined,
  nodeType?: string | null,
): string | null {
  if (!code) return null;
  // Objetivo de aprendizaje: extraer el número del OA del propio código.
  if (nodeType === 'learning_objective') {
    const oa = code.match(/OA0*(\d+)/i);
    return oa ? `OA-${oa[1]}` : null;
  }
  // Asignatura pura.
  const subj = SUBJECT_LABELS[code.toUpperCase()];
  if (subj) return subj;
  // Código técnico: se oculta; el nombre del nodo ya es legible.
  return null;
}
