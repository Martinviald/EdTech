'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  MIN_SEARCH_TERM_LENGTH,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  Clock,
  GraduationCap,
  Shapes,
  Users,
} from 'lucide-react';
import {
  ActiveFilterChips,
  FilterMenu,
  TopProgressBar,
  type FilterDimension,
} from '@/components/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PROCESS_OPT_OUT_KEY,
  classGroupSelectOptionsMulti,
  type DashboardFilterValues,
} from './dashboard-filters';
import { AssessmentSearchField } from './assessment-search-field';
import { useDebouncedSearch } from './use-debounced-search';

// La lógica pura de filtros (tipo, claves, parse/serialize) vive en
// `./dashboard-filters` (módulo sin 'use client') para que las páginas server la
// reutilicen. Re-exportamos el tipo por compatibilidad de imports existentes.
export type { DashboardFilterValues };

// El "momento" (Diagnóstico/Monitoreo/Cierre) sólo aplica a instrumentos con
// ciclo de aplicación; hoy ese tipo es DIA (mismo criterio que InstrumentFilters).
const PERIODIC_TYPE = 'dia';

export function DashboardFilterBar({
  options,
  value,
  basePath,
}: {
  options: DashboardFilterOptionsResponse;
  value: DashboardFilterValues;
  /** basePath de la ruta actual; el bar actualiza la querystring (router.push). */
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Envolver el push en una transición mantiene el contenido previo visible
  // (sin flash de skeleton) y expone `isPending` para la barra de progreso.
  const [isPending, startTransition] = useTransition();

  // Aplica varias claves de filtro en un solo router.push (atómico). Un array se
  // serializa como CSV; vacío/null borra la clave. Cambiar filtros reinicia la
  // paginación (H6.4).
  const applyFilters = useCallback(
    (updates: Partial<Record<keyof DashboardFilterValues, string | string[] | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, next] of Object.entries(updates)) {
        if (Array.isArray(next)) {
          if (next.length > 0) params.set(key, next.join(','));
          else params.delete(key);
        } else if (next) {
          params.set(key, next);
        } else {
          params.delete(key);
        }
      }
      params.delete('page');
      const qs = params.toString();
      startTransition(() => {
        router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
      });
    },
    [router, searchParams, basePath],
  );

  // Buscador por palabras (docs/diseno-buscador-evaluaciones.md). Los tres
  // disparadores (temporizador, Enter, botón) pasan por `applyFilters`, que ya
  // borra `page` y ya envuelve el push en la transición.
  const submitSearch = useCallback(
    (nextTerm: string) => applyFilters({ q: nextTerm || null }),
    [applyFilters],
  );
  const search = useDebouncedSearch({
    initialTerm: value.q ?? '',
    minLength: MIN_SEARCH_TERM_LENGTH,
    onSubmit: submitSearch,
  });

  const updateSingle = useCallback(
    (key: keyof DashboardFilterValues, next: string) => applyFilters({ [key]: next || null }),
    [applyFilters],
  );

  const updateMulti = useCallback(
    (key: keyof DashboardFilterValues, ids: string[]) => applyFilters({ [key]: ids }),
    [applyFilters],
  );

  // Al quitar el tipo con ciclo (DIA), se descarta también el filtro de momento.
  const updateInstrumentTypes = useCallback(
    (ids: string[]) =>
      applyFilters({
        instrumentType: ids,
        ...(ids.includes(PERIODIC_TYPE) ? {} : { applicationPeriod: [] }),
      }),
    [applyFilters],
  );

  // Al cambiar los niveles, poda los cursos seleccionados que ya no pertenezcan
  // a ningún nivel elegido (no filtrar por un curso que desaparece del dropdown).
  const updateGrades = useCallback(
    (gradeIds: string[]) => {
      const selectedGrades = new Set(gradeIds);
      const current = value.classGroupId ?? [];
      const pruned =
        selectedGrades.size === 0
          ? current
          : current.filter((cgId) => {
              const cg = options.classGroups.find((c) => c.id === cgId);
              return cg?.gradeId != null && selectedGrades.has(cg.gradeId);
            });
      applyFilters({
        gradeId: gradeIds,
        ...(pruned.length !== current.length ? { classGroupId: pruned } : {}),
      });
    },
    [applyFilters, options.classGroups, value.classGroupId],
  );

  // El proceso por defecto necesita su propia marca de "quitado": borrar la clave
  // de la URL no alcanza, porque la preselección la volvería a poner en el acto.
  const updateProcess = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) {
        params.set('processId', next);
        params.delete(PROCESS_OPT_OUT_KEY);
      } else {
        params.delete('processId');
        params.set(PROCESS_OPT_OUT_KEY, '1');
      }
      params.delete('page');
      const qs = params.toString();
      startTransition(() => {
        router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
      });
    },
    [router, searchParams, basePath],
  );

  // Tipos de instrumento únicos derivados de las opciones de instrumentos.
  const instrumentTypes = Array.from(new Set(options.instruments.map((i) => i.type)));

  // El dropdown de Cursos solo muestra los cursos de los niveles seleccionados.
  // Sin nivel elegido se muestran todos, con el nivel antepuesto en la etiqueta.
  const courseOptions = classGroupSelectOptionsMulti(
    options.classGroups,
    options.grades,
    value.gradeId,
  );

  // El filtro de "Momento" sólo se muestra si hay un tipo con ciclo seleccionado.
  const showPeriod = value.instrumentType?.includes(PERIODIC_TYPE) ?? false;

  // Instrumento concreto (T2-14): jerarquía Asignatura/Nivel/Tipo → instrumento.
  const selectedSubjects = new Set(value.subjectId ?? []);
  const selectedTypes = new Set(value.instrumentType ?? []);
  const selectedGrades = new Set(value.gradeId ?? []);
  const scopedInstruments = options.instruments
    .filter(
      (i) =>
        selectedSubjects.size === 0 || (i.subjectId != null && selectedSubjects.has(i.subjectId)),
    )
    .filter((i) => selectedTypes.size === 0 || selectedTypes.has(i.type))
    .filter(
      (i) => selectedGrades.size === 0 || (i.gradeId != null && selectedGrades.has(i.gradeId)),
    );
  const instrumentOptions = scopedInstruments.map((i) => ({ id: i.id, label: i.label }));

  // Momentos con evaluaciones reales en el alcance visible (lo calcula el backend:
  // el catálogo de instrumentos no basta, un momento puede tener instrumentos
  // oficiales y ninguna evaluación del colegio). Se anota en el dropdown para no
  // dejar al usuario filtrando a ciegas.
  const periodsWithData = new Set(options.applicationPeriodsWithData);

  // El nombre de un proceso no siempre trae el año ("Cierre" vs "DIA Cierre 2026"),
  // y el desplegable mezcla años: se antepone el período sólo cuando falta, para no
  // dejar dos entradas homónimas indistinguibles.
  const periodLabels = new Map(options.periods.map((p) => [p.id, p.label]));
  const processOptions = options.processes.map((p) => {
    const periodLabel = p.academicYearId ? periodLabels.get(p.academicYearId) : undefined;
    const needsPeriod = periodLabel && !p.label.includes(periodLabel);
    const base = needsPeriod ? `${p.label} · ${periodLabel}` : p.label;
    // Mismo criterio que los momentos sin evaluaciones: se anota en vez de
    // ocultarse, para no dejar a nadie filtrando a ciegas hacia una vista vacía.
    return { id: p.id, label: p.hasResults ? base : `${base} · sin resultados` };
  });

  // Proceso y período definen QUÉ se está comparando (Panorama preselecciona un
  // proceso para no mezclar pruebas no comparables), así que el control de alcance
  // queda siempre a la vista. Cuando el colegio no tiene procesos, ese lugar lo
  // ocupa el período. El resto de las dimensiones vive en el menú "Filtros" y lo
  // aplicado se ve como chips: esconder qué filtra los datos llevaría a leerlos mal.
  const scopeIsProcess = processOptions.length > 0;
  const periodOptions = options.periods.map((p) => ({ id: p.id, label: p.label }));

  const dimensions: FilterDimension[] = [
    {
      key: 'academicYearId',
      label: 'Período',
      icon: CalendarDays,
      mode: 'single',
      options: periodOptions,
      selected: value.academicYearId ? [value.academicYearId] : [],
      onChange: (ids) => updateSingle('academicYearId', ids[0] ?? ''),
      hidden: !scopeIsProcess,
    },
    {
      key: 'subjectId',
      label: 'Asignatura',
      icon: BookOpen,
      mode: 'multi',
      options: options.subjects,
      selected: value.subjectId ?? [],
      onChange: (ids) => updateMulti('subjectId', ids),
    },
    {
      key: 'gradeId',
      label: 'Nivel',
      icon: GraduationCap,
      mode: 'multi',
      options: options.grades,
      selected: value.gradeId ?? [],
      onChange: updateGrades,
    },
    {
      key: 'classGroupId',
      label: 'Curso',
      icon: Users,
      mode: 'multi',
      options: courseOptions,
      selected: value.classGroupId ?? [],
      onChange: (ids) => updateMulti('classGroupId', ids),
    },
    {
      key: 'instrumentType',
      label: 'Tipo de instrumento',
      icon: Shapes,
      mode: 'multi',
      options: instrumentTypes.map((t) => ({ id: t, label: t.toUpperCase() })),
      selected: value.instrumentType ?? [],
      onChange: updateInstrumentTypes,
      hidden: instrumentTypes.length === 0,
    },
    {
      key: 'instrumentId',
      label: 'Instrumento',
      icon: ClipboardList,
      mode: 'single',
      options: instrumentOptions,
      selected: value.instrumentId ? [value.instrumentId] : [],
      onChange: (ids) => updateSingle('instrumentId', ids[0] ?? ''),
      hidden: instrumentOptions.length === 0 && !value.instrumentId,
    },
    {
      key: 'applicationPeriod',
      label: 'Momento',
      icon: Clock,
      mode: 'multi',
      options: INSTRUMENT_APPLICATION_PERIODS.map((p) => ({
        id: p,
        label: INSTRUMENT_APPLICATION_PERIOD_LABELS[p],
        hint: periodsWithData.has(p) ? undefined : 'sin evaluaciones',
      })),
      selected: value.applicationPeriod ?? [],
      onChange: (ids) => updateMulti('applicationPeriod', ids),
      hidden: !showPeriod,
    },
  ];

  const clearMenuFilters = () =>
    applyFilters(
      Object.fromEntries(dimensions.filter((d) => !d.hidden).map((d) => [d.key, null])) as Partial<
        Record<keyof DashboardFilterValues, null>
      >,
    );

  return (
    <div className="relative space-y-2">
      {/* El `isPending` de la transición NO se enciende durante la espera del
          temporizador: sin `isDebouncing` la barra se ve muerta justo en esos
          segundos (docs/diseno-buscador-evaluaciones.md §D9). */}
      <TopProgressBar active={isPending || search.isDebouncing} />
      <div className="flex flex-wrap items-start gap-2">
        {scopeIsProcess ? (
          <ScopeSelect
            ariaLabel="Proceso de medición"
            placeholder="Todos los procesos"
            value={value.processId}
            options={processOptions}
            onChange={updateProcess}
          />
        ) : (
          <ScopeSelect
            ariaLabel="Período"
            placeholder="Todos los períodos"
            value={value.academicYearId}
            options={periodOptions}
            onChange={(v) => updateSingle('academicYearId', v)}
          />
        )}
        <div className="min-w-[220px] flex-1 sm:max-w-sm">
          <AssessmentSearchField
            term={search.term}
            onTermChange={search.setTerm}
            onSubmit={search.submitNow}
            isDebouncing={search.isDebouncing}
            isTooShort={search.isTooShort}
            minLength={MIN_SEARCH_TERM_LENGTH}
          />
        </div>
        <FilterMenu dimensions={dimensions} className="ml-auto" />
      </div>
      <ActiveFilterChips dimensions={dimensions} onClearAll={clearMenuFilters} />
    </div>
  );
}

/** Valor centinela para la opción "todos" (Radix Select no admite value vacío). */
const ALL = '__all__';

function ScopeSelect({
  ariaLabel,
  placeholder,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  placeholder: string;
  value: string | undefined;
  options: readonly { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? '' : next)}>
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-9 w-full bg-card sm:w-auto sm:min-w-[220px] sm:max-w-[320px]"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
