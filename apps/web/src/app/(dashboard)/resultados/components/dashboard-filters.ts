// Lógica pura de filtros del dashboard de resultados.
//
// Vive en un módulo SIN `'use client'` para que las páginas (Server Components)
// puedan llamar `parseDashboardFilters`/`buildDashboardQuery` directamente. El
// componente interactivo `DashboardFilterBar` ('use client') importa de aquí el
// tipo y las claves. No mover estas funciones a un archivo cliente: Next prohíbe
// invocar exports de un módulo cliente desde el servidor.

import { parseCursoLabel, type ClassGroupFilterOption, type FilterOption } from '@soe/types';

export type DashboardFilterValues = {
  subjectId?: string;
  gradeId?: string;
  classGroupId?: string;
  studentId?: string;
  academicYearId?: string;
  instrumentType?: string;
};

/** Claves de filtro que viven en la querystring. */
export const FILTER_KEYS: readonly (keyof DashboardFilterValues)[] = [
  'subjectId',
  'gradeId',
  'classGroupId',
  'studentId',
  'academicYearId',
  'instrumentType',
];

/**
 * Parsea los filtros del dashboard desde el objeto `searchParams` resuelto de
 * Next 15. Reutilizado por todas las páginas de `/resultados`.
 */
export function parseDashboardFilters(
  params: Record<string, string | string[] | undefined>,
): DashboardFilterValues {
  const pick = (key: keyof DashboardFilterValues): string | undefined => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && value.length > 0 ? value : undefined;
  };
  return {
    subjectId: pick('subjectId'),
    gradeId: pick('gradeId'),
    classGroupId: pick('classGroupId'),
    studentId: pick('studentId'),
    academicYearId: pick('academicYearId'),
    instrumentType: pick('instrumentType'),
  };
}

// ── Cascada Nivel → Curso ────────────────────────────────────────────────────
// El nombre de un curso ("A", "B", "C") no dice a qué nivel pertenece, así que
// todo dropdown de cursos se filtra por el nivel elegido y, mientras no haya
// nivel, muestra el nombre calificado ("3° Básico A"). Helpers compartidos por
// `DashboardFilterBar` y `ProgressionScopeBar` para no duplicar la regla.

/** Cursos del nivel indicado; sin nivel elegido, todos los cursos. */
export function classGroupsForGrade(
  classGroups: ClassGroupFilterOption[],
  gradeId: string | undefined,
): ClassGroupFilterOption[] {
  return gradeId ? classGroups.filter((c) => c.gradeId === gradeId) : classGroups;
}

/**
 * `true` si el curso seleccionado sigue siendo válido para el nivel indicado.
 * Sin curso o sin nivel no hay conflicto posible.
 */
export function isClassGroupInGrade(
  classGroups: ClassGroupFilterOption[],
  classGroupId: string | undefined,
  gradeId: string | null | undefined,
): boolean {
  if (!classGroupId || !gradeId) return true;
  return classGroups.some((c) => c.id === classGroupId && c.gradeId === gradeId);
}

/**
 * Opciones de curso para un `Select`. Sin nivel elegido antepone el nombre del
 * nivel para desambiguar los cursos homónimos de distintos niveles.
 *
 * No todas las orgs nombran los cursos igual: unas guardan sólo la sección ("A")
 * y otras el curso completo ("1° Medio B"). Anteponer el nivel a las segundas
 * daba "1° Medio 1° Medio B", así que sólo se antepone cuando el nombre NO trae
 * ya el nivel adentro (`parseCursoLabel` devuelve null para una sección suelta).
 */
export function classGroupSelectOptions(
  classGroups: ClassGroupFilterOption[],
  grades: FilterOption[],
  gradeId: string | undefined,
): FilterOption[] {
  const gradeLabels = new Map(grades.map((g) => [g.id, g.label]));
  return classGroupsForGrade(classGroups, gradeId).map((c) => {
    const alreadyQualified = parseCursoLabel(c.label) !== null;
    const gradeLabel =
      gradeId || !c.gradeId || alreadyQualified ? undefined : gradeLabels.get(c.gradeId);
    return { id: c.id, label: gradeLabel ? `${gradeLabel} ${c.label}` : c.label };
  });
}

/** Serializa los filtros a una querystring (orden estable, sin claves vacías). */
export function buildDashboardQuery(value: DashboardFilterValues): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = value[key];
    if (v) params.set(key, v);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
