/**
 * Parseo tolerante de etiquetas de curso usadas por colegios chilenos.
 *
 * Acepta variantes como:
 *   "1° Medio A", "1 Medio A", "1M A", "1MA", "1°MA"
 *   "8° Básico B", "8 Basico B", "8B B", "8BB"
 *   "Kinder A", "K A", "KA"
 *   "Pre-Kinder B", "PK B", "PKB"
 *
 * Retorna `{ gradeCode, section }` listos para resolver contra la tabla `grades`
 * por `code`. La sección es siempre una letra (A-Z) en mayúscula.
 *
 * Retorna `null` si no se puede inferir un código y/o sección.
 */
export type ParsedCurso = {
  gradeCode: string;
  section: string;
  /** Etiqueta normalizada (útil para mostrar al usuario). */
  normalized: string;
};

const SECTION_RE = /([A-Z])\s*$/;

export function parseCursoLabel(input: string | null | undefined): ParsedCurso | null {
  if (!input || typeof input !== 'string') return null;

  const raw = stripAccents(input).trim().toUpperCase();
  if (raw.length === 0) return null;

  const sectionMatch = raw.match(SECTION_RE);
  const section = sectionMatch?.[1];
  if (!section || sectionMatch?.index === undefined) return null;

  const gradePart = raw.slice(0, sectionMatch.index).trim().replace(/\s+/g, ' ');
  if (!gradePart) return null;

  const gradeCode = matchGradeCode(gradePart);
  if (!gradeCode) return null;

  return {
    gradeCode,
    section,
    normalized: `${prettyGrade(gradeCode)} ${section}`,
  };
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Mapea variantes humanas al `grades.code` canónico definido en el seed.
 * El seed usa códigos como `PRE_KINDER`, `KINDER`, `1RD_BASIC`...`8TH_BASIC`,
 * `1ST_MEDIO`...`4TH_MEDIO`.
 */
function matchGradeCode(input: string): string | null {
  const compact = input.replace(/[°\s-]/g, '');

  if (/^PREK|^PRK|^PKINDER|^PREKINDER/.test(compact)) return 'PRE_KINDER';
  if (/^KINDER$|^K$|^KIN$/.test(compact)) return 'KINDER';

  const basicMatch = compact.match(/^(\d{1,2})(B|BASIC|BASICO|BAS)?$/);
  if (basicMatch) {
    const n = Number(basicMatch[1]);
    if (n >= 1 && n <= 8) return basicNum(n);
  }

  const mediumMatch = compact.match(/^(\d{1,2})(M|MEDIO|MED)$/);
  if (mediumMatch) {
    const n = Number(mediumMatch[1]);
    if (n >= 1 && n <= 4) return medioNum(n);
  }

  const onlyDigits = compact.match(/^(\d{1,2})$/);
  if (onlyDigits) {
    const n = Number(onlyDigits[1]);
    if (n >= 1 && n <= 8) return basicNum(n);
  }

  return null;
}

const BASIC_CODES = [
  '1RD_BASIC',
  '2ND_BASIC',
  '3RD_BASIC',
  '4TH_BASIC',
  '5TH_BASIC',
  '6TH_BASIC',
  '7TH_BASIC',
  '8TH_BASIC',
] as const;

const MEDIO_CODES = ['1ST_MEDIO', '2ND_MEDIO', '3RD_MEDIO', '4TH_MEDIO'] as const;

function basicNum(n: number): string {
  return BASIC_CODES[n - 1] ?? '';
}

function medioNum(n: number): string {
  return MEDIO_CODES[n - 1] ?? '';
}

/**
 * Normaliza lo que un usuario escribe como "sección" de un curso al valor que se
 * guarda en `class_groups.name`: sólo la sección ("A"), nunca el curso completo.
 *
 * El nivel ya vive en `grade_id`; repetirlo dentro del nombre produce catálogos
 * inconsistentes ("4° Básico A" junto a "A" para el mismo nivel), que es cómo se
 * ensució la data de demo. Si el texto trae el nivel adentro ("4B A", "4° Básico
 * A") se queda con la sección; si no, se devuelve tal cual, sin inventar nada.
 */
export function normalizeClassGroupSection(input: string): string {
  const trimmed = input.trim();
  const parsed = parseCursoLabel(trimmed);
  if (parsed) return parsed.section;
  // Sin nivel reconocible: una sola letra se guarda en mayúscula ("a" → "A"),
  // cualquier otro nombre se respeta (hay colegios con secciones no-literales).
  return /^[a-zA-Z]$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

function prettyGrade(code: string): string {
  const labels: Record<string, string> = {
    PRE_KINDER: 'Pre-Kinder',
    KINDER: 'Kinder',
    '1RD_BASIC': '1° Básico',
    '2ND_BASIC': '2° Básico',
    '3RD_BASIC': '3° Básico',
    '4TH_BASIC': '4° Básico',
    '5TH_BASIC': '5° Básico',
    '6TH_BASIC': '6° Básico',
    '7TH_BASIC': '7° Básico',
    '8TH_BASIC': '8° Básico',
    '1ST_MEDIO': '1° Medio',
    '2ND_MEDIO': '2° Medio',
    '3RD_MEDIO': '3° Medio',
    '4TH_MEDIO': '4° Medio',
  };
  return labels[code] ?? code;
}
