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

// ── Contrato compartido (lo consume FE-B) ────────────────────────────────────
// FE-B importa `DashboardFilterBar`, `DashboardFilterValues` y
// `parseDashboardFilters` desde esta ruta. La firma de props NO cambia.

export type DashboardFilterValues = {
  subjectId?: string;
  gradeId?: string;
  classGroupId?: string;
  studentId?: string;
  academicYearId?: string;
  instrumentType?: string;
};

/** Claves de filtro que viven en la querystring. */
const FILTER_KEYS: readonly (keyof DashboardFilterValues)[] = [
  'subjectId',
  'gradeId',
  'classGroupId',
  'studentId',
  'academicYearId',
  'instrumentType',
];

/** Valor centinela para la opción "todos" (Radix Select no admite value vacío). */
const ALL = '__all__';

/**
 * Parsea los filtros del dashboard desde el objeto `searchParams` resuelto de
 * Next 15. Vive en `components/` para que las páginas (FE-A y FE-B) lo
 * reutilicen sin duplicar lógica.
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

  const updateFilter = useCallback(
    (key: keyof DashboardFilterValues, next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next && next !== ALL) {
        params.set(key, next);
      } else {
        params.delete(key);
      }
      // Cambiar filtros reinicia la paginación de la clasificación (H6.4).
      params.delete('page');
      const qs = params.toString();
      router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
    },
    [router, searchParams, basePath],
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
        onChange={(v) => updateFilter('gradeId', v)}
      />
      <FilterSelect
        label="Curso"
        placeholder="Todos los cursos"
        value={value.classGroupId}
        options={options.classGroups.map((c) => ({ id: c.id, label: c.label }))}
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
