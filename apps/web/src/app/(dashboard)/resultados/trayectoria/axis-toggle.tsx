'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Toggle del EJE de la trayectoria. No es un filtro más: mantiene todos los
// filtros (querystring) y sólo cambia QUÉ se grafica sobre ellos — años
// (generacional, N2) o momentos del ciclo (N3). Vive fuera de la barra de filtros.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { COMPARABLE_TRAJECTORY_AXES, type ComparableTrajectoryAxis } from '@soe/types';
import { TopProgressBar } from '@/components/shared';
import { cn } from '@/lib/utils';

const AXIS_LABELS: Record<ComparableTrajectoryAxis, string> = {
  years: 'Años',
  moments: 'Momentos',
};

export function AxisToggle({
  axis,
  basePath,
}: {
  axis: ComparableTrajectoryAxis;
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setAxis = useCallback(
    (next: ComparableTrajectoryAxis) => {
      if (next === axis) return;
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('axis', next);
      startTransition(() => router.push(`${basePath}?${sp.toString()}` as Route));
    },
    [axis, router, searchParams, basePath],
  );

  return (
    <div
      role="tablist"
      aria-label="Eje de la trayectoria"
      className="relative inline-flex items-center gap-0.5 overflow-hidden rounded-md border bg-muted/40 p-0.5"
    >
      <TopProgressBar active={isPending} position="bottom" className="rounded-none" />
      {COMPARABLE_TRAJECTORY_AXES.map((a) => {
        const active = a === axis;
        return (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={isPending}
            onClick={() => setAxis(a)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {AXIS_LABELS[a]}
          </button>
        );
      })}
    </div>
  );
}
