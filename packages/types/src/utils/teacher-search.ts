/**
 * Búsqueda de docentes por nombre o correo (selector de asignaciones académicas).
 *
 * Vive acá y no en el componente porque es lógica pura y testeable, y porque el CI
 * corre los tests de `@soe/types` en cada PR (CLAUDE.md §3: si puede ir en `packages/`,
 * va en `packages/`).
 */

/** Sin tildes y en minúsculas: buscar "gonzalez" tiene que encontrar a "González". */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Mínimo de caracteres para desplegar resultados. Con menos, la lista se abre entera y
 * deja de ser un buscador: en un colegio son ~80 docentes y habría que reconocerlos por
 * orden alfabético, que es exactamente lo que el buscador vino a reemplazar.
 */
export const MIN_TEACHER_QUERY_LENGTH = 2;

export type TeacherSearchable = { name: string; email: string };

/**
 * Coincide si TODOS los términos escritos aparecen en el nombre o en el correo.
 *
 * Por tokens y no como una sola subcadena para que "javiera gonz" encuentre a
 * "Javiera González" sin depender del orden. Una consulta vacía NO coincide con nadie:
 * sin búsqueda no hay resultados que desplegar.
 */
export function matchesTeacherQuery(teacher: TeacherSearchable, query: string): boolean {
  const tokens = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const haystack = `${normalizeForSearch(teacher.name)} ${normalizeForSearch(teacher.email)}`;
  return tokens.every((token) => haystack.includes(token));
}
