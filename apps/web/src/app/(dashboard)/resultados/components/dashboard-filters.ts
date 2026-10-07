// Lógica pura de filtros del dashboard de resultados.
//
// Vive en un módulo SIN `'use client'` para que las páginas (Server Components)
// puedan llamar `parseDashboardFilters`/`buildDashboardQuery` directamente. El
// componente interactivo `DashboardFilterBar` ('use client') importa de aquí el
// tipo y las claves. No mover estas funciones a un archivo cliente: Next prohíbe
// invocar exports de un módulo cliente desde el servidor.

import { parseCursoLabel, type ClassGroupFilterOption, type FilterOption } from '@soe/types';

export type DashboardFilterValues = {
  // Multi-select (T2-12): CSV en la querystring → array.
  subjectId?: string[];
  gradeId?: string[];
  classGroupId?: string[];
  instrumentType?: string[];
  // Momento DIA (T2-27): sólo aplica a instrumentos con ciclo de aplicación.
  applicationPeriod?: string[];
  // Escalares: instrumento concreto (T2-14), alumno de drill, período único.
  instrumentId?: string;
  studentId?: string;
  academicYearId?: string;
  // Proceso de medición (docs/diseno-procesos-de-medicion.md): acota el alcance a
  // las evaluaciones de una ventana de aplicación con una sola clave.
  processId?: string;
  /**
   * "Quiero ver todos los procesos": desactiva la preselección del proceso por
   * defecto. NO es un filtro — no está en `FILTER_KEYS`, así que nunca viaja a la
   * API — sino la memoria de que el usuario quitó el default a mano.
   */
  processOptOut?: boolean;
  // Buscador por palabras (docs/diseno-buscador-evaluaciones.md): texto libre que
  // acota por nombre de evaluación o de instrumento. Es un filtro más, no un modo
  // aparte: se combina con AND con el resto y vive en la URL.
  q?: string;
};

/** Tope de longitud del término, espejo de `MAX_SEARCH_TERM_LENGTH` del backend. */
const MAX_SEARCH_TERM_LENGTH = 100;

/**
 * Claves de filtro que viajan en la querystring Y a la API.
 *
 * El `Exclude` no es decorativo: `processOptOut` es un booleano de UI, y sin
 * sacarlo del tipo `buildDashboardQuery` intentaría serializar `true` como valor
 * de query. Toda clave que se agregue al tipo sin ser un filtro real tiene que
 * excluirse acá.
 */
type QueryFilterKey = Exclude<keyof DashboardFilterValues, 'processOptOut'>;

export const FILTER_KEYS: readonly QueryFilterKey[] = [
  'subjectId',
  'gradeId',
  'classGroupId',
  'instrumentType',
  'applicationPeriod',
  'instrumentId',
  'studentId',
  'academicYearId',
  'processId',
  'q',
];

/**
 * Acota los filtros al año académico vigente cuando la URL no pide uno.
 *
 * Sin esto, las vistas listan la historia completa del colegio: en la demo son 258
 * evaluaciones de dos años en `/evaluaciones` y 116 unidades en el panorama, cuando
 * lo que se mira a diario es el año en curso. El año elegido es el que ya resuelve
 * `/dashboards/filters` (`defaultAcademicYearId`: el pedido, o el vigente, o el más
 * reciente con cursos), así que la barra de filtros y los datos hablan del mismo.
 *
 * No es un filtro escondido: se pasa también a la barra, que lo muestra seleccionado
 * y permite cambiarlo o quitarlo para ver toda la historia.
 *
 * Excepción: un proceso de medición YA declara su propia ventana, y casi siempre la
 * de un año que no es el vigente. Inyectarle encima el año por defecto cruzaba dos
 * filtros incompatibles y dejaba el panorama en blanco — que es lo que pasaba al
 * entrar por "Ver panorama" desde cualquier proceso de un año anterior.
 */
export function withDefaultAcademicYear(
  value: DashboardFilterValues,
  defaultAcademicYearId: string | null,
): DashboardFilterValues {
  if (value.processId) return value;
  if (value.academicYearId || !defaultAcademicYearId) return value;
  return { ...value, academicYearId: defaultAcademicYearId };
}

/**
 * Clave de URL que marca "quiero ver todos los procesos". NO viaja a la API ni
 * está en `FILTER_KEYS`: sólo desactiva la preselección.
 *
 * Hace falta porque "no hay proceso en la URL" es ambiguo — puede ser que acabas
 * de entrar, o que quitaste el filtro a mano. Sin distinguirlas, el default se
 * vuelve a inyectar en el mismo instante en que lo quitas y el filtro es
 * inescapable. Es el defecto que hoy tiene el año académico por defecto, y que
 * acá no se repite.
 */
export const PROCESS_OPT_OUT_KEY = 'noProcess';

/**
 * Preselecciona el proceso más reciente con resultados al entrar sin filtros.
 *
 * Se aplica ANTES que {@link withDefaultAcademicYear}: un proceso ya declara su
 * ventana, así que cuando hay proceso no se inyecta año (cruzar ambos vaciaba la
 * vista para todo proceso de un año que no fuera el vigente).
 */
export function withDefaultProcess(
  value: DashboardFilterValues,
  defaultProcessId: string | null,
): DashboardFilterValues {
  if (value.processOptOut || value.processId || !defaultProcessId) return value;
  // Guarda simétrica a la de `withDefaultAcademicYear`. Si el usuario eligió un
  // año a mano, preseleccionarle encima un proceso —que casi siempre es de OTRO
  // año— cruza dos filtros incompatibles y deja la vista en blanco. Pidió un año:
  // se le da el año.
  if (value.academicYearId) return value;
  return { ...value, processId: defaultProcessId };
}

/**
 * Los defaults de entrada, en el orden correcto y en un solo lugar.
 *
 * Existe para que las cinco páginas que los aplican no puedan quedar
 * desincronizadas: el orden importa (proceso antes que año, ver
 * {@link withDefaultProcess}) y repetirlo en cada `page.tsx` es pedir que una se
 * quede atrás en el próximo default que se agregue.
 */
export function withEntryDefaults(
  value: DashboardFilterValues,
  options: { defaultProcessId: string | null; defaultAcademicYearId: string | null },
): DashboardFilterValues {
  return withDefaultAcademicYear(
    withDefaultProcess(value, options.defaultProcessId),
    options.defaultAcademicYearId,
  );
}

/** ¿Hay algún filtro aplicado? Decide si un resultado vacío se explica por los filtros. */
export function hasActiveFilters(value: DashboardFilterValues): boolean {
  return FILTER_KEYS.some((key) => {
    const v = value[key];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });
}

/**
 * Parsea los filtros del dashboard desde el objeto `searchParams` resuelto de
 * Next 15. Reutilizado por todas las páginas de `/resultados`.
 */
export function parseDashboardFilters(
  params: Record<string, string | string[] | undefined>,
): DashboardFilterValues {
  const pick = (key: string): string | undefined => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && value.length > 0 ? value : undefined;
  };
  const pickAll = (key: string): string[] | undefined => {
    const raw = params[key];
    const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    const parts = values
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    return parts.length > 0 ? parts : undefined;
  };
  return {
    subjectId: pickAll('subjectId'),
    gradeId: pickAll('gradeId'),
    classGroupId: pickAll('classGroupId'),
    instrumentType: pickAll('instrumentType'),
    applicationPeriod: pickAll('applicationPeriod'),
    instrumentId: pick('instrumentId'),
    studentId: pick('studentId'),
    academicYearId: pick('academicYearId'),
    processId: pick('processId'),
    processOptOut: pick(PROCESS_OPT_OUT_KEY) === '1',
    q: pick('q')?.trim().slice(0, MAX_SEARCH_TERM_LENGTH) || undefined,
  };
}

// ── Cascada Nivel → Curso ────────────────────────────────────────────────────
// El nombre de un curso ("A", "B", "C") no dice a qué nivel pertenece, así que
// todo dropdown de cursos se filtra por el nivel elegido y, mientras no haya
// nivel, muestra el nombre calificado ("3° Básico A"). Helpers compartidos por
// `DashboardFilterBar` y `TrajectoryScopeBar` para no duplicar la regla.

/** Cursos del nivel indicado; sin nivel elegido, todos los cursos. */
export function classGroupsForGrade(
  classGroups: ClassGroupFilterOption[],
  gradeId: string | undefined,
): ClassGroupFilterOption[] {
  return gradeId ? classGroups.filter((c) => c.gradeId === gradeId) : classGroups;
}

/** Cursos de CUALQUIERA de los niveles indicados; sin niveles, todos (T2-12). */
export function classGroupsForGrades(
  classGroups: ClassGroupFilterOption[],
  gradeIds: string[] | undefined,
): ClassGroupFilterOption[] {
  if (!gradeIds || gradeIds.length === 0) return classGroups;
  const set = new Set(gradeIds);
  return classGroups.filter((c) => c.gradeId != null && set.has(c.gradeId));
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

/** Igual que {@link classGroupSelectOptions} pero para multi-nivel (T2-12). */
export function classGroupSelectOptionsMulti(
  classGroups: ClassGroupFilterOption[],
  grades: FilterOption[],
  gradeIds: string[] | undefined,
): FilterOption[] {
  const gradeLabels = new Map(grades.map((g) => [g.id, g.label]));
  const noGradeFilter = !gradeIds || gradeIds.length === 0;
  return classGroupsForGrades(classGroups, gradeIds).map((c) => {
    const alreadyQualified = parseCursoLabel(c.label) !== null;
    const gradeLabel =
      noGradeFilter && c.gradeId && !alreadyQualified ? gradeLabels.get(c.gradeId) : undefined;
    return { id: c.id, label: gradeLabel ? `${gradeLabel} ${c.label}` : c.label };
  });
}

/**
 * Vista escalar de los filtros para consumidores single-value (drill-down por
 * un camino, comparación generacional): un valor sólo si hay EXACTAMENTE uno
 * seleccionado; con multi-selección el filtro se considera "no fijado" (T2-12).
 */
export type DashboardScalarFilters = {
  subjectId?: string;
  gradeId?: string;
  classGroupId?: string;
  studentId?: string;
  academicYearId?: string;
  instrumentType?: string;
};

export function toScalarFilters(f: DashboardFilterValues): DashboardScalarFilters {
  const one = (a?: string[]): string | undefined => (a?.length === 1 ? a[0] : undefined);
  return {
    subjectId: one(f.subjectId),
    gradeId: one(f.gradeId),
    classGroupId: one(f.classGroupId),
    instrumentType: one(f.instrumentType),
    studentId: f.studentId,
    academicYearId: f.academicYearId,
  };
}

/**
 * Querystring para un ENLACE de la vista (no para la API): igual que
 * {@link buildDashboardQuery} pero conservando la marca de opt-out.
 *
 * `buildDashboardQuery` la omite a propósito —no es un filtro y no viaja al
 * backend—, pero un enlace construido con ella devolvía al usuario el proceso por
 * defecto que acababa de quitar. Todo `href` que se arme desde filtros usa ésta.
 */
export function buildDashboardHref(value: DashboardFilterValues): string {
  const base = buildDashboardQuery(value);
  if (!value.processOptOut) return base;
  return base ? `${base}&${PROCESS_OPT_OUT_KEY}=1` : `?${PROCESS_OPT_OUT_KEY}=1`;
}

/**
 * Querystring que quita el proceso Y deja la marca de que fue a propósito.
 * Sin `noProcess=1` el default se reinyecta en el mismo render y el enlace no
 * hace nada visible.
 */
export function buildClearProcessQuery(value: DashboardFilterValues): string {
  const base = buildDashboardQuery({ ...value, processId: undefined });
  return base ? `${base}&${PROCESS_OPT_OUT_KEY}=1` : `?${PROCESS_OPT_OUT_KEY}=1`;
}

/** Serializa los filtros a una querystring (orden estable, sin claves vacías). */
/**
 * Claves que ACOTAN el alcance dentro de un proceso.
 *
 * `processId` no está: es el alcance mismo. `academicYearId` tampoco — se
 * preselecciona solo y el proceso vive en un año, así que filtrar por ese año no
 * recorta nada. `studentId` sí: un alumno es un subconjunto del proceso.
 */
const NARROWING_KEYS = [
  'subjectId',
  'gradeId',
  'classGroupId',
  'instrumentType',
  'applicationPeriod',
  'instrumentId',
  'studentId',
  'q',
] as const;

/**
 * ¿Hay algún filtro que recorte el proceso?
 *
 * Importa porque `/measurement-processes/:id/coverage` NO acepta filtros: su
 * denominador es el del proceso completo. Cruzarlo con un numerador recortado
 * hunde el cociente bajo el piso del titular y deja las celdas de las otras
 * asignaturas marcadas como si no tuvieran niveles. Es el mismo desajuste que ya
 * se evita con alcance docente.
 */
export function hasNarrowingFilters(value: DashboardFilterValues): boolean {
  return NARROWING_KEYS.some((key) => {
    const found = value[key];
    return Array.isArray(found) ? found.length > 0 : found != null && found !== '';
  });
}

export function buildDashboardQuery(value: DashboardFilterValues): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = value[key];
    if (Array.isArray(v)) {
      if (v.length > 0) params.set(key, v.join(','));
    } else if (v) {
      params.set(key, v);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
