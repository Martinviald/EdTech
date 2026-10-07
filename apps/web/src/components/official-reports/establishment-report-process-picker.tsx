'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import type { PeriodFilterOption } from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─────────────────────────────────────────────────────────────────────────────
// Filtro del informe de establecimiento (TKT-25). El endpoint agrega por
// grado × asignatura para un año académico. El "momento" (period) es un string
// genérico de `assessments.config.period` que no se enumera desde ningún
// endpoint, por lo que aquí sólo se expone el selector de año académico
// (data-driven de `options.periods`). Sin selección, el backend usa el año
// marcado `is_current`. El `period` puede pasarse por querystring si un enlace
// externo lo trae, pero no se hardcodea una lista de momentos.
// ─────────────────────────────────────────────────────────────────────────────

const ALL = '__all__';

export function EstablishmentReportFilters({
  academicYears,
  value,
  basePath,
}: {
  academicYears: PeriodFilterOption[];
  value: { academicYearId?: string };
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next && next !== ALL) {
        params.set('academicYearId', next);
      } else {
        params.delete('academicYearId');
      }
      const qs = params.toString();
      router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
    },
    [router, searchParams, basePath],
  );

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 print:hidden">
      <div className="flex min-w-[180px] flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Año académico</span>
        <Select value={value.academicYearId ?? ALL} onValueChange={onChange}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Año en curso" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Año en curso</SelectItem>
            {academicYears.map((y) => (
              <SelectItem key={y.id} value={y.id}>
                {y.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
