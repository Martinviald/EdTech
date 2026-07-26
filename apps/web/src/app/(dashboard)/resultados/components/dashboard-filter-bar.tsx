'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import { FilterX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterBar, MultiSelectFilter, type FilterField } from '@/components/shared';
import {
  FILTER_KEYS,
  classGroupSelectOptionsMulti,
  type DashboardFilterValues,
} from './dashboard-filters';

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

  const clearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_KEYS) params.delete(key);
    params.delete('page');
    const qs = params.toString();
    startTransition(() => {
      router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
    });
  }, [router, searchParams, basePath]);

  const hasActive = FILTER_KEYS.some((k) => {
    const v = value[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });

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
  const instrumentOptions = options.instruments
    .filter(
      (i) =>
        selectedSubjects.size === 0 || (i.subjectId != null && selectedSubjects.has(i.subjectId)),
    )
    .filter((i) => selectedTypes.size === 0 || selectedTypes.has(i.type))
    .filter(
      (i) => selectedGrades.size === 0 || (i.gradeId != null && selectedGrades.has(i.gradeId)),
    )
    .map((i) => ({ id: i.id, label: i.label }));

  const fields: FilterField[] = [
    {
      key: 'academicYearId',
      label: 'Período',
      placeholder: 'Todos los períodos',
      value: value.academicYearId,
      options: options.periods.map((p) => ({ id: p.id, label: p.label })),
      onChange: (v) => updateSingle('academicYearId', v),
    },
    {
      key: 'subjectId',
      label: 'Asignatura',
      control: (
        <MultiSelectFilter
          label="asignaturas"
          placeholder="Todas las asignaturas"
          options={options.subjects}
          selected={value.subjectId ?? []}
          onChange={(ids) => updateMulti('subjectId', ids)}
        />
      ),
    },
    {
      key: 'gradeId',
      label: 'Nivel / Grado',
      control: (
        <MultiSelectFilter
          label="niveles"
          placeholder="Todos los grados"
          options={options.grades}
          selected={value.gradeId ?? []}
          onChange={updateGrades}
        />
      ),
    },
    {
      key: 'classGroupId',
      label: 'Curso',
      control: (
        <MultiSelectFilter
          label="cursos"
          placeholder="Todos los cursos"
          options={courseOptions}
          selected={value.classGroupId ?? []}
          onChange={(ids) => updateMulti('classGroupId', ids)}
        />
      ),
    },
    {
      key: 'instrumentType',
      label: 'Tipo de instrumento',
      hidden: instrumentTypes.length === 0,
      control: (
        <MultiSelectFilter
          label="tipos"
          placeholder="Todos los tipos"
          options={instrumentTypes.map((t) => ({ id: t, label: t.toUpperCase() }))}
          selected={value.instrumentType ?? []}
          onChange={updateInstrumentTypes}
        />
      ),
    },
    {
      key: 'instrumentId',
      label: 'Instrumento',
      placeholder: 'Todos los instrumentos',
      value: value.instrumentId,
      options: instrumentOptions,
      onChange: (v) => updateSingle('instrumentId', v),
      hidden: instrumentOptions.length === 0,
    },
    {
      key: 'applicationPeriod',
      label: 'Momento',
      hidden: !showPeriod,
      control: (
        <MultiSelectFilter
          label="momentos"
          placeholder="Todos los momentos"
          options={INSTRUMENT_APPLICATION_PERIODS.map((p) => ({
            id: p,
            label: INSTRUMENT_APPLICATION_PERIOD_LABELS[p],
          }))}
          selected={value.applicationPeriod ?? []}
          onChange={(ids) => updateMulti('applicationPeriod', ids)}
        />
      ),
    },
  ];

  return (
    <FilterBar
      fields={fields}
      pending={isPending}
      actions={
        <Button
          variant="ghost"
          size="icon"
          onClick={clearAll}
          disabled={!hasActive}
          title="Limpiar filtros"
          aria-label="Limpiar filtros"
        >
          <FilterX />
        </Button>
      }
    />
  );
}
