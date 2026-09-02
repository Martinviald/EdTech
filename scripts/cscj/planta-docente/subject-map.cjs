/* Mapeo de las etiquetas de asignatura de la planta docente del colegio a los
   códigos del catálogo `subjects`.

   DECISIÓN (docs/diseno-alcance-docente.md §6): NO se amplía el catálogo. Sólo
   se importan las asignaturas que tienen evaluaciones en la plataforma
   (LANG, MATH, SCI, HIST, ENG). El resto de la planta —Arte, Música, Ed.
   Física, Religión, Orientación, Tecnología, Biblioteca, electivos no
   troncales— es un DESCARTE ESPERADO, no un error de mapeo: el importador los
   reporta por separado.

   Las agrupaciones sí son decisiones de fondo y quedan explícitas aquí:
     - Biología / Química / Física / Ciencias para la Ciudadanía → SCI
       (sin esto la enseñanza media queda sin ciencias).
     - Educación Ciudadana / Economía y Sociedad / Geografía / Comprensión
       Histórica del Presente / Filosofía Política → HIST
       (son el departamento de Historia en la planta).
*/

/** Etiqueta de la planta (normalizada) → `subjects.code`. */
const SUBJECT_MAP = {
  // LANG
  LENGUAJE: 'LANG',
  'TALLER DE LITERATURA': 'LANG',
  'SIMCE LEN': 'LANG',
  'LECTURA Y ESCRITURA ESPECIALIZADA SECCION 1': 'LANG',
  'LECTURA Y ESCRITURA ESPECIALIZADA SECCION 2': 'LANG',
  'ESCRITURA Y ORALIDAD': 'LANG',
  'PARTICIPACION Y ARGUMENTACION EN DEMOCRACIA': 'LANG',
  // MATH
  MATEMATICAS: 'MATH',
  'SIMCE MAT': 'MATH',
  'LIMITES Y DERIVADAS': 'MATH',
  'PROBABILIDADES Y ESTADISTICAS': 'MATH',
  // SCI
  CIENCIAS: 'SCI',
  BIOLOGIA: 'SCI',
  QUIMICA: 'SCI',
  FISICA: 'SCI',
  'CIENCIAS PARA LA CIUDADANIA': 'SCI',
  'TALLER DE CIENCIAS': 'SCI',
  'BIOLOGIA CELULAR Y MOLECULAR': 'SCI',
  'BIOLOGIA DE LOS ECOSISTEMAS': 'SCI',
  'PAES CIENCIAS': 'SCI',
  // HIST
  HISTORIA: 'HIST',
  'TALLER DE HISTORIA': 'HIST',
  'PAES HISTORIA': 'HIST',
  'EDUCACION CIUDADANA': 'HIST',
  'COMPRENSION HISTORICA DEL PRESENTE': 'HIST',
  'ECONOMIA Y SOCIEDAD': 'HIST',
  'GEOGRAFIA, TERRITORIO Y DESAFIOS SOCIO-AMBIENTALES': 'HIST',
  'FILOSOFIA POLITICA': 'HIST',
  // ENG
  INGLES: 'ENG',
};

/* Filas que NO son docencia de aula: jefatura, reuniones, cargos y horas no
   lectivas. Se excluyen antes de intentar mapear (no cuentan como descarte de
   asignatura). La jefatura se procesa aparte, como membership. */
const NON_TEACHING = new Set([
  'JEFATURA DE CURSO',
  'RDN',
  'REU PJ CICLO',
  'REU DEP',
  'REU DE CICLO',
  'REU JEF DEP',
  'REU SIMCE',
  'JEF DEP',
  'MENTORIA',
  'MENTORIA REU',
  'CONSEJO MARTES',
  'EQUIPO DIRECTIVO',
  'PISE',
  'SONIDO',
  'CASC',
  'COORD TALLERES',
  'LIBRE DISP',
  'FLOTANTE',
  'DOCENCIA',
  'CO DOCENCIA',
  'LABORATORIO',
  'EVALUACION',
  'PASTORAL',
  'PSICOPEDAGOGA',
  'EDUCADORA DIFERENCIAL',
  'PROYECTO',
  'REFORZAMIENTO',
]);

function normalizeLabel(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** → `{ code }` si la asignatura se importa; `{ skip: 'non_teaching' | 'not_evaluated' }` si no. */
function mapSubject(label) {
  const key = normalizeLabel(label);
  if (NON_TEACHING.has(key)) return { skip: 'non_teaching' };
  const code = SUBJECT_MAP[key];
  return code ? { code } : { skip: 'not_evaluated' };
}

/* Los niveles de media vienen en romano en la planta y `parseCursoLabel` sólo
   entiende arábigo + "Medio" (misma conversión que 01-extract-roster.cjs). */
const ROMAN_TO_LABEL = { I: '1 Medio', II: '2 Medio', III: '3 Medio', IV: '4 Medio' };

/** "III° Medio C" → "3 Medio C"; "2° Básico A" y "Kínder B" pasan sin cambio. */
function toParsableCurso(label) {
  const raw = normalizeLabel(label);
  const m = raw.match(/^(I|II|III|IV)\s*°?\s*MEDIO\s+([A-Z])$/);
  if (m) return `${ROMAN_TO_LABEL[m[1]]} ${m[2]}`;
  return raw;
}

module.exports = { SUBJECT_MAP, NON_TEACHING, normalizeLabel, mapSubject, toParsableCurso };
