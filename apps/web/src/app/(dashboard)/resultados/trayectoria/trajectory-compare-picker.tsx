'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { GitCompareArrows } from 'lucide-react';
import type { ComparableTrajectoryPoint, ComparableTrajectoryYearSeries } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

type PickablePoint = ComparableTrajectoryPoint & { id: string; caption: string };

function pointsOf(series: ComparableTrajectoryYearSeries[]): PickablePoint[] {
  const points: PickablePoint[] = [];
  for (const line of series) {
    for (const point of line.points) {
      points.push({
        ...point,
        id: `${line.year ?? 'none'}-${point.key}`,
        caption: point.year == null ? point.label : `${point.label} ${point.year}`,
      });
    }
  }
  return points;
}

function compareHref(base: PickablePoint, comparison: PickablePoint): Route | null {
  const baseId = base.assessmentIds.length === 1 ? base.assessmentIds[0] : null;
  const comparisonId = comparison.assessmentIds.length === 1 ? comparison.assessmentIds[0] : null;
  const qs = new URLSearchParams();
  if (baseId) {
    qs.set('baseId', baseId);
    if (comparisonId) qs.set('comparisonId', comparisonId);
  } else if (comparisonId) {
    qs.set('baseId', comparisonId);
  } else {
    return null;
  }
  return `${ROUTES.compararInstrumentos}?${qs.toString()}` as Route;
}

export function TrajectoryComparePicker({ series }: { series: ComparableTrajectoryYearSeries[] }) {
  const points = useMemo(() => pointsOf(series), [series]);
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const [selected, setSelected] = useState<string[]>([]);

  if (points.length < 2) return null;

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      return current.length >= 2 ? [current[1]!, id] : [...current, id];
    });
  };

  const base = selected[0] ? byId.get(selected[0]) : undefined;
  const comparison = selected[1] ? byId.get(selected[1]) : undefined;
  const href = base && comparison ? compareHref(base, comparison) : null;
  const opensBaseOnly =
    href !== null && base !== undefined && comparison !== undefined
      ? base.assessmentIds.length !== 1 || comparison.assessmentIds.length !== 1
      : false;

  return (
    <Card hover={false}>
      <CardHeader>
        <CardTitle className="text-base">Comparar dos puntos</CardTitle>
        <CardDescription>
          Elige la base y luego el punto a comparar. Si un punto reúne varias evaluaciones (varios
          cursos), el comparador se abre sólo con el punto que tiene una evaluación, como base;
          elige un curso para comparar evaluaciones puntuales.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {points.map((point) => {
            const position = selected.indexOf(point.id);
            const multiple = point.assessmentIds.length > 1;
            return (
              <Button
                key={point.id}
                type="button"
                size="sm"
                variant={position >= 0 ? 'secondary' : 'outline'}
                aria-pressed={position >= 0}
                onClick={() => toggle(point.id)}
                className={cn(position >= 0 && 'ring-2 ring-primary/40')}
              >
                {position === 0 ? 'Base · ' : position === 1 ? 'Comparada · ' : ''}
                {point.caption}
                {multiple ? (
                  <span className="text-xs text-muted-foreground">
                    ({point.assessmentIds.length} evaluaciones)
                  </span>
                ) : null}
              </Button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {base && comparison && !href ? (
            <p className="mr-auto text-sm text-muted-foreground">
              Ambos puntos reúnen varias evaluaciones. Elige un curso para compararlas.
            </p>
          ) : null}
          {opensBaseOnly ? (
            <p className="mr-auto text-sm text-muted-foreground">
              Un punto reúne varias evaluaciones: el comparador se abrirá sólo con el otro punto,
              como base.
            </p>
          ) : null}
          {href ? (
            <Button asChild className="gap-2">
              <Link href={href}>
                <GitCompareArrows className="size-4" aria-hidden />
                Comparar
              </Link>
            </Button>
          ) : (
            <Button className="gap-2" disabled>
              <GitCompareArrows className="size-4" aria-hidden />
              Comparar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
