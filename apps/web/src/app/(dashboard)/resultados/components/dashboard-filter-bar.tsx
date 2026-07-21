'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import type { DashboardFilterOptionsResponse } from '@soe/types';
import { FilterX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterBar, type FilterField } from '@/components/shared';
import { FILTER_KEYS, type DashboardFilterValues } from './dashboard-filters';

// La lógica pura de filtros (tipo, claves, parse/serialize) vive en
// `./dashboard-filters` (módulo sin 'use client') para que las páginas server la
// reutilicen. Re-exportamos el tipo por compatibilidad de imports existentes.
export type { DashboardFilterValues };

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

  // Aplica varias claves de filtro en un solo router.push (atómico). Un valor
  // vacío borra la clave. Cambiar filtros reinicia la paginación (H6.4).
  const applyFilters = useCallback(
    (updates: Partial<Record<keyof DashboardFilterValues, string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, next] of Object.entries(updates)) {
        if (next) {
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

  const updateFilter = useCallback(
    (key: keyof DashboardFilterValues, next: string) => applyFilters({ [key]: next }),
    [applyFilters],
  );

  // Al elegir un nivel, si el curso ya seleccionado no pertenece a ese nivel,
  // se limpia junto con el cambio de grado (evita filtrar por un curso que ni
  // siquiera aparece en el dropdown de Cursos).
  const updateGrade = useCallback(
    (next: string) => {
      const nextGrade = next || null;
      const courseStillValid =
        !value.classGroupId ||
        !nextGrade ||
        options.classGroups.some(
          (c) => c.id === value.classGroupId && c.gradeId === nextGrade,
        );
      applyFilters({
        gradeId: nextGrade,
        ...(courseStillValid ? {} : { classGroupId: null }),
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

  const hasActive = FILTER_KEYS.some((k) => Boolean(value[k]));

  // Tipos de instrumento únicos derivados de las opciones de instrumentos.
  const instrumentTypes = Array.from(
    new Map(options.instruments.map((i) => [i.type, i.type])).values(),
  );

  // El dropdown de Cursos solo muestra los cursos del nivel seleccionado.
  // Sin nivel elegido, se muestran todos.
  const coursesForGrade = value.gradeId
    ? options.classGroups.filter((c) => c.gradeId === value.gradeId)
    : options.classGroups;

  const fields: FilterField[] = [
    {
      key: 'academicYearId',
      label: 'Período',
      placeholder: 'Todos los períodos',
      value: value.academicYearId,
      options: options.periods.map((p) => ({ id: p.id, label: p.label })),
      onChange: (v) => updateFilter('academicYearId', v),
    },
    {
      key: 'subjectId',
      label: 'Asignatura',
      placeholder: 'Todas las asignaturas',
      value: value.subjectId,
      options: options.subjects,
      onChange: (v) => updateFilter('subjectId', v),
    },
    {
      key: 'gradeId',
      label: 'Nivel / Grado',
      placeholder: 'Todos los grados',
      value: value.gradeId,
      options: options.grades,
      onChange: updateGrade,
    },
    {
      key: 'classGroupId',
      label: 'Curso',
      placeholder: 'Todos los cursos',
      value: value.classGroupId,
      options: coursesForGrade.map((c) => ({ id: c.id, label: c.label })),
      onChange: (v) => updateFilter('classGroupId', v),
    },
    {
      key: 'instrumentType',
      label: 'Tipo de instrumento',
      placeholder: 'Todos los tipos',
      value: value.instrumentType,
      options: instrumentTypes.map((t) => ({ id: t, label: t.toUpperCase() })),
      onChange: (v) => updateFilter('instrumentType', v),
      hidden: instrumentTypes.length === 0,
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
