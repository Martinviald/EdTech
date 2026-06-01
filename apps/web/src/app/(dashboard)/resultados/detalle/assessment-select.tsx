'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import type { AssessmentOption } from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─────────────────────────────────────────────────────────────────────────────
// Selector de evaluación para la tabla cruzada (H6.11). Escribe `assessmentId`
// en la querystring (conservando los filtros activos) y resetea la paginación.
// La matriz es siempre por evaluación, por eso este selector es el punto de
// entrada de la vista.
// ─────────────────────────────────────────────────────────────────────────────

const NONE = '__none__';

function formatOptionLabel(opt: AssessmentOption): string {
  const base = opt.name ?? opt.instrumentName;
  const meta = [opt.subjectName, opt.gradeName].filter(Boolean).join(' · ');
  return meta ? `${base} — ${meta}` : base;
}

function formatDate(value: string | Date | null): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function AssessmentSelect({
  options,
  value,
  basePath,
}: {
  options: AssessmentOption[];
  value?: string;
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next && next !== NONE) {
        params.set('assessmentId', next);
      } else {
        params.delete('assessmentId');
      }
      // Cambiar de evaluación reinicia la paginación de alumnos.
      params.delete('page');
      const qs = params.toString();
      router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
    },
    [router, searchParams, basePath],
  );

  return (
    <div className="flex min-w-[240px] flex-1 flex-col gap-1 sm:flex-none">
      <span className="text-xs font-medium text-muted-foreground">Evaluación</span>
      <Select value={value ?? NONE} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-[360px]">
          <SelectValue placeholder="Selecciona una evaluación" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Selecciona una evaluación</SelectItem>
          {options.map((opt) => {
            const date = formatDate(opt.administeredAt);
            return (
              <SelectItem key={opt.assessmentId} value={opt.assessmentId}>
                {formatOptionLabel(opt)}
                {date ? ` · ${date}` : ''} · {opt.studentsCount} alumnos
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
