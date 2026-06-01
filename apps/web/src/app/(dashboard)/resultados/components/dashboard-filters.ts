// Lógica pura de filtros del dashboard de resultados.
//
// Vive en un módulo SIN `'use client'` para que las páginas (Server Components)
// puedan llamar `parseDashboardFilters`/`buildDashboardQuery` directamente. El
// componente interactivo `DashboardFilterBar` ('use client') importa de aquí el
// tipo y las claves. No mover estas funciones a un archivo cliente: Next prohíbe
// invocar exports de un módulo cliente desde el servidor.

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
