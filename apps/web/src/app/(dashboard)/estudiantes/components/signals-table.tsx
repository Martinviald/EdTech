'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Search, UserRound } from 'lucide-react';
import {
  STUDENT_SIGNALS,
  STUDENT_SIGNAL_DESCRIPTIONS,
  STUDENT_SIGNAL_LABELS,
  type StudentSignal,
  type StudentSignalsResponse,
} from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { EmptyState, TopProgressBar } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { formatAchievement } from '../../resultados/components/performance-level';
import { cn } from '@/lib/utils';

export function SignalsTable({
  result,
  activeSignal,
  search,
}: {
  result: StudentSignalsResponse;
  activeSignal: StudentSignal | null;
  search: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const push = (params: URLSearchParams) => {
    const qs = params.toString();
    startTransition(() => {
      router.push(`${ROUTES.estudiantes}${qs ? `?${qs}` : ''}` as Route);
    });
  };

  const toggleSignal = (signal: StudentSignal) => {
    const params = new URLSearchParams(searchParams.toString());
    if (activeSignal === signal) params.delete('signal');
    else params.set('signal', signal);
    push(params);
  };

  const onSearch = (term: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (term.trim() === '') params.delete('search');
    else params.set('search', term.trim());
    push(params);
  };

  return (
    <div className="relative space-y-4">
      <TopProgressBar active={isPending} />

      <div className="flex flex-wrap items-center gap-2">
        {STUDENT_SIGNALS.map((signal) => {
          const count = result.counts[signal];
          const isActive = activeSignal === signal;
          return (
            <button
              key={signal}
              type="button"
              onClick={() => toggleSignal(signal)}
              disabled={count === 0 && !isActive}
              title={STUDENT_SIGNAL_DESCRIPTIONS[signal]}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted',
                count === 0 && !isActive && 'cursor-not-allowed opacity-50',
              )}
            >
              {STUDENT_SIGNAL_LABELS[signal]}
              <span className="tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      <form
        className="relative sm:max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get('search');
          onSearch(typeof value === 'string' ? value : '');
        }}
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          name="search"
          defaultValue={search}
          placeholder="Buscar por nombre o RUT en todo el colegio"
          className="pl-9"
          aria-label="Buscar estudiante"
        />
      </form>

      {result.data.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="Sin estudiantes para este filtro"
          description="Prueba con otra señal, otro curso, o busca por nombre."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Estudiante</th>
                <th className="px-4 py-2 font-medium">Curso</th>
                <th className="px-4 py-2 font-medium">Última evaluación</th>
                <th className="px-4 py-2 font-medium">% logro</th>
                <th className="px-4 py-2 font-medium">Nivel</th>
                <th className="px-4 py-2 font-medium">Señales</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((row) => (
                <tr key={row.studentId} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-2">
                    <Link
                      href={ROUTES.estudiante(row.studentId)}
                      className="font-medium hover:underline"
                    >
                      {row.fullName}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{row.rut}</span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {row.gradeName ? `${row.gradeName} ${row.classGroupName ?? ''}`.trim() : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {row.latest ? (
                      <span className="block max-w-[16rem] truncate">
                        {row.latest.instrumentName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Sin resultados</span>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {formatAchievement(row.latest?.achievement ?? null)}
                    {row.dropPp !== null ? (
                      <span className="ml-1.5 text-xs font-medium text-destructive tabular-nums">
                        {row.dropPp} pp
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <PerformanceBadge level={null} band={row.latest?.performanceBand ?? null} />
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {row.signals.map((signal) => (
                        <Badge
                          key={signal}
                          variant={signal === 'persistent_low' ? 'destructive' : 'warning'}
                          className="text-2xs"
                          title={STUDENT_SIGNAL_DESCRIPTIONS[signal]}
                        >
                          {STUDENT_SIGNAL_LABELS[signal]}
                        </Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {result.total} {result.total === 1 ? 'estudiante' : 'estudiantes'} en el alcance
        {result.data.length < result.total ? ` · mostrando ${result.data.length}` : ''}
      </p>
    </div>
  );
}
