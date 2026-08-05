'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  type StudentPanoramaAppliedFilters,
  type StudentPanoramaFilterOptions,
} from '@soe/types';
import { FilterBar, type FilterField } from '@/components/shared';

const ALL_YEARS = 'allYears';

export function PanoramaFilters({
  studentId,
  options,
  value,
}: {
  studentId: string;
  options: StudentPanoramaFilterOptions;
  value: StudentPanoramaAppliedFilters;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const push = (params: URLSearchParams) => {
    const qs = params.toString();
    startTransition(() => {
      router.push(`/estudiantes/${studentId}${qs ? `?${qs}` : ''}` as Route);
    });
  };

  const update = (key: string, next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === '') params.delete(key);
    else params.set(key, next);
    push(params);
  };

  const updateYear = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('year');
    params.delete(ALL_YEARS);
    if (next === ALL_YEARS) params.set(ALL_YEARS, 'true');
    else if (next !== '') params.set('year', next);
    push(params);
  };

  const fields: FilterField[] = [
    {
      key: 'subjectId',
      label: 'Asignatura',
      placeholder: 'Todas las asignaturas',
      value: value.subjectId ?? undefined,
      options: options.subjects
        .filter((s): s is { id: string; name: string | null } => s.id !== null)
        .map((s) => ({ id: s.id, label: s.name ?? 'Sin asignatura' })),
      onChange: (next) => update('subjectId', next),
      hidden: options.subjects.length < 2,
    },
    {
      key: 'year',
      label: 'Año',
      placeholder: 'Elige un año',
      value: value.allYears ? ALL_YEARS : (value.year?.toString() ?? undefined),
      options: [
        { id: ALL_YEARS, label: 'Todos los años' },
        ...options.years.map((y) => ({ id: String(y), label: String(y) })),
      ],
      onChange: updateYear,
      hidden: options.years.length === 0,
    },
    {
      key: 'applicationPeriod',
      label: 'Momento',
      placeholder: 'Todos los momentos',
      value: value.applicationPeriod ?? undefined,
      options: options.applicationPeriods.map((p) => ({
        id: p,
        label: INSTRUMENT_APPLICATION_PERIOD_LABELS[p],
      })),
      onChange: (next) => update('applicationPeriod', next),
      hidden: options.applicationPeriods.length < 2,
    },
    {
      key: 'instrumentType',
      label: 'Instrumento',
      placeholder: 'Todos los tipos',
      value: value.instrumentType ?? undefined,
      options: options.instrumentTypes.map((t) => ({ id: t, label: t.toUpperCase() })),
      onChange: (next) => update('instrumentType', next),
      hidden: options.instrumentTypes.length < 2,
    },
  ];

  return <FilterBar fields={fields} pending={isPending} />;
}
