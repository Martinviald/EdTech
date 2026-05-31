'use client';

// ─────────────────────────────────────────────────────────────────────────────
// STUB FE-B — Filter Bar compartido (contrato §3.2 de docs/sprint4-contracts.md).
//
// ⚠️ Este archivo es propiedad de FE-A. FE-B lo crea SÓLO como stub para poder
// compilar/consumir mientras FE-A no está mergeado. En integración (Fase 4) la
// versión real de FE-A reemplaza a ésta. El contrato de props (firma exacta de
// DashboardFilterBar, DashboardFilterValues y parseDashboardFilters) NO cambia.
// ─────────────────────────────────────────────────────────────────────────────

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

export type DashboardFilterValues = {
  subjectId?: string;
  gradeId?: string;
  classGroupId?: string;
  studentId?: string;
  academicYearId?: string;
  instrumentType?: string;
};

const ALL = '__all__';

/** Parsea los filtros compartidos desde los searchParams ya resueltos (Next 15). */
export function parseDashboardFilters(
  params: Record<string, string | string[] | undefined>,
): DashboardFilterValues {
  const pick = (key: string): string | undefined => {
    const v = params[key];
    const value = Array.isArray(v) ? v[0] : v;
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

export function DashboardFilterBar(props: {
  options: DashboardFilterOptionsResponse;
  value: DashboardFilterValues;
  /** basePath de la ruta actual; el bar actualiza la querystring (router.push). */
  basePath: string;
}) {
  const { options, value, basePath } = props;
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, next: string | undefined) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next && next !== ALL) sp.set(key, next);
      else sp.delete(key);
      const qs = sp.toString();
      router.push((qs ? `${basePath}?${qs}` : basePath) as Route);
    },
    [router, searchParams, basePath],
  );

  const instrumentTypes = Array.from(
    new Set(options.instruments.map((i) => i.type)),
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <FilterSelect
        label="Asignatura"
        value={value.subjectId}
        onChange={(v) => updateParam('subjectId', v)}
        options={options.subjects.map((s) => ({ id: s.id, label: s.label }))}
        placeholder="Todas"
      />
      <FilterSelect
        label="Nivel"
        value={value.gradeId}
        onChange={(v) => updateParam('gradeId', v)}
        options={options.grades.map((g) => ({ id: g.id, label: g.label }))}
        placeholder="Todos"
      />
      <FilterSelect
        label="Curso"
        value={value.classGroupId}
        onChange={(v) => updateParam('classGroupId', v)}
        options={options.classGroups.map((c) => ({ id: c.id, label: c.label }))}
        placeholder="Todos"
      />
      <FilterSelect
        label="Período"
        value={value.academicYearId}
        onChange={(v) => updateParam('academicYearId', v)}
        options={options.periods.map((p) => ({ id: p.id, label: p.label }))}
        placeholder="Todos"
      />
      <FilterSelect
        label="Instrumento"
        value={value.instrumentType}
        onChange={(v) => updateParam('instrumentType', v)}
        options={instrumentTypes.map((t) => ({ id: t, label: t.toUpperCase() }))}
        placeholder="Todos"
      />
    </div>
  );
}

function FilterSelect(props: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: { id: string; label: string }[];
  placeholder: string;
}) {
  const { label, value, onChange, options, placeholder } = props;
  return (
    <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select
        value={value ?? ALL}
        onValueChange={(v) => onChange(v === ALL ? undefined : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
