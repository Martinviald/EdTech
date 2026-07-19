'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import type { DashboardFilterOptionsResponse } from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  FILTER_KEYS,
  classGroupSelectOptions,
  isClassGroupInGrade,
  type DashboardFilterValues,
} from './dashboard-filters';

// La lógica pura de filtros (tipo, claves, parse/serialize) vive en
// `./dashboard-filters` (módulo sin 'use client') para que las páginas server la
// reutilicen. Re-exportamos el tipo por compatibilidad de imports existentes.
export type { DashboardFilterValues };

/** Valor centinela para la opción "todos" (Radix Select no admite value vacío). */
const ALL = '__all__';

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

  // Aplica varias claves de filtro en un solo router.push (atómico). Un valor
  // null/vacío/ALL borra la clave. Cambiar filtros reinicia la paginación (H6.4).
  const applyFilters = useCallback(
    (updates: Partial<Record<keyof DashboardFilterValues, string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, next] of Object.entries(updates)) {
        if (next && next !== ALL) {
          params.set(key, next);
        } else {
          params.delete(key);
        }
      }
      params.delete('page');
      const qs = params.toString();
      router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
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
      const nextGrade = next && next !== ALL ? next : null;
      const courseStillValid = isClassGroupInGrade(
        options.classGroups,
        value.classGroupId,
        nextGrade,
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
    router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
  }, [router, searchParams, basePath]);

  const hasActive = FILTER_KEYS.some((k) => Boolean(value[k]));

  // Tipos de instrumento únicos derivados de las opciones de instrumentos.
  const instrumentTypes = Array.from(
    new Map(options.instruments.map((i) => [i.type, i.type])).values(),
  );

  // El dropdown de Cursos solo muestra los cursos del nivel seleccionado. Sin
  // nivel elegido se muestran todos, con el nivel antepuesto en la etiqueta.
  const courseOptions = classGroupSelectOptions(options.classGroups, options.grades, value.gradeId);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
      <FilterSelect
        label="Período"
        placeholder="Todos los períodos"
        value={value.academicYearId}
        options={options.periods.map((p) => ({ id: p.id, label: p.label }))}
        onChange={(v) => updateFilter('academicYearId', v)}
      />
      <FilterSelect
        label="Asignatura"
        placeholder="Todas las asignaturas"
        value={value.subjectId}
        options={options.subjects}
        onChange={(v) => updateFilter('subjectId', v)}
      />
      <FilterSelect
        label="Nivel / Grado"
        placeholder="Todos los grados"
        value={value.gradeId}
        options={options.grades}
        onChange={updateGrade}
      />
      <FilterSelect
        label="Curso"
        placeholder="Todos los cursos"
        value={value.classGroupId}
        options={courseOptions}
        onChange={(v) => updateFilter('classGroupId', v)}
      />
      {instrumentTypes.length > 0 ? (
        <FilterSelect
          label="Tipo de instrumento"
          placeholder="Todos los tipos"
          value={value.instrumentType}
          options={instrumentTypes.map((t) => ({ id: t, label: t.toUpperCase() }))}
          onChange={(v) => updateFilter('instrumentType', v)}
        />
      ) : null}

      {hasActive ? (
        <Button variant="ghost" size="sm" onClick={clearAll} className="self-end">
          Limpiar filtros
        </Button>
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string | undefined;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-[160px] flex-1 flex-col gap-1 sm:flex-none">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value ?? ALL} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-[180px]">
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
    </div>
  );
}
