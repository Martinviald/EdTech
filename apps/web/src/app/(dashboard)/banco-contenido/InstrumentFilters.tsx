'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import type { Route } from 'next';
import { ROUTES } from '@/lib/routes';
import { TopProgressBar } from '@/components/shared';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  type CatalogEntryModel,
} from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL = 'all';

/** Tipo cuyo ciclo de aplicación (diagnóstico/monitoreo/cierre) se puede filtrar. */
const PERIODIC_TYPE = 'dia';

const TYPE_OPTIONS = [
  { value: 'dia', label: 'DIA' },
  { value: 'simce', label: 'SIMCE' },
  { value: 'paes', label: 'PAES' },
  { value: 'cambridge_mock', label: 'Cambridge' },
  { value: 'aptus', label: 'Aptus' },
  { value: 'desafio', label: 'Desafio' },
  { value: 'pal', label: 'PAL' },
  { value: 'custom', label: 'Personalizado' },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Borrador' },
  { value: 'published', label: 'Publicado' },
  { value: 'archived', label: 'Archivado' },
];

interface InstrumentFiltersProps {
  subjects: CatalogEntryModel[];
  grades: CatalogEntryModel[];
  /** Años con al menos un instrumento visible (facetas del API). */
  years: number[];
}

/**
 * Filtros del banco de instrumentos. Solo escriben la selección en la URL; el
 * filtrado ocurre server-side (el Server Component refetchea). El dropdown de
 * momento de aplicación se renderiza únicamente para los tipos que tienen ciclo
 * de aplicación (hoy DIA).
 */
export function InstrumentFilters({ subjects, grades, years }: InstrumentFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // La transición mantiene visible el listado previo mientras llega el nuevo y
  // expone `isPending` para la barra de progreso (sin flash de skeleton).
  const [isPending, startTransition] = useTransition();

  const currentType = searchParams.get('type') ?? '';
  const currentStatus = searchParams.get('status') ?? '';
  const currentYear = searchParams.get('year') ?? '';
  const currentSubject = searchParams.get('subjectId') ?? '';
  const currentGrade = searchParams.get('gradeId') ?? '';
  const currentPeriod = searchParams.get('applicationPeriod') ?? '';

  const showPeriodFilter = currentType === PERIODIC_TYPE;

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // El momento solo aplica al tipo periódico: al salir de él se descarta, o
      // quedaría filtrando de forma invisible (su dropdown ya no se renderiza).
      if (key === 'type' && value !== PERIODIC_TYPE) {
        params.delete('applicationPeriod');
      }
      params.set('page', '1');
      startTransition(() => {
        router.push(`${ROUTES.bancoItems}?${params.toString()}` as Route);
      });
    },
    [router, searchParams],
  );

  return (
    <div className="relative flex flex-wrap items-center gap-3">
      <TopProgressBar active={isPending} />
      <Select value={currentType || ALL} onValueChange={(v) => updateFilter('type', v)}>
        <SelectTrigger className="w-[160px]" aria-label="Tipo">
          <SelectValue placeholder="Tipo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los tipos</SelectItem>
          {TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showPeriodFilter ? (
        <Select
          value={currentPeriod || ALL}
          onValueChange={(v) => updateFilter('applicationPeriod', v)}
        >
          <SelectTrigger className="w-[170px]" aria-label="Momento de aplicación">
            <SelectValue placeholder="Momento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los momentos</SelectItem>
            {INSTRUMENT_APPLICATION_PERIODS.map((period) => (
              <SelectItem key={period} value={period}>
                {INSTRUMENT_APPLICATION_PERIOD_LABELS[period]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <Select value={currentSubject || ALL} onValueChange={(v) => updateFilter('subjectId', v)}>
        <SelectTrigger className="w-[180px]" aria-label="Asignatura">
          <SelectValue placeholder="Asignatura" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todas las asignaturas</SelectItem>
          {subjects.map((subject) => (
            <SelectItem key={subject.id} value={subject.id}>
              {subject.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentGrade || ALL} onValueChange={(v) => updateFilter('gradeId', v)}>
        <SelectTrigger className="w-[160px]" aria-label="Nivel">
          <SelectValue placeholder="Nivel" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los niveles</SelectItem>
          {grades.map((grade) => (
            <SelectItem key={grade.id} value={grade.id}>
              {grade.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentYear || ALL} onValueChange={(v) => updateFilter('year', v)}>
        <SelectTrigger className="w-[130px]" aria-label="Año">
          <SelectValue placeholder="Año" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los años</SelectItem>
          {years.map((year) => (
            <SelectItem key={year} value={String(year)}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentStatus || ALL} onValueChange={(v) => updateFilter('status', v)}>
        <SelectTrigger className="w-[160px]" aria-label="Estado">
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los estados</SelectItem>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
