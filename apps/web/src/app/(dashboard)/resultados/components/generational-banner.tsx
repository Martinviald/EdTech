import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, TrendingDown, TrendingUp, Users } from 'lucide-react';
import type { GenerationalHighlight } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';
import { formatAchievement } from './performance-level';

/**
 * Cómo se movió cada generación: el mismo nivel y asignatura, este año contra el
 * anterior.
 *
 * Es la única lectura del panorama donde los alumnos comparados son OTROS — de ahí el
 * nombre. Se apoya en el baseline `previous_year` de cada unidad, así que compara el
 * mismo instrumento contra sí mismo: peras con peras aunque cambie la cohorte.
 *
 * No concluye nada sobre la causa: enuncia el movimiento y su magnitud, y manda al
 * detalle (regla de diseño de T3-01).
 */

/** Cuántas celdas se muestran antes de mandar a la vista completa. */
const VISIBLE_LIMIT = 3;

/** Bajo este movimiento no vale la pena ocupar espacio: es ruido de medición. */
const MIN_RELEVANT_PP = 2;

function comparisonHref(cell: GenerationalHighlight): Route {
  const params = new URLSearchParams();
  if (cell.gradeId) params.set('gradeId', cell.gradeId);
  if (cell.subjectId) params.set('subjectId', cell.subjectId);
  return `${ROUTES.resultadosTrayectoria}?${params.toString()}` as Route;
}

export function GenerationalBanner({ cells }: { cells: GenerationalHighlight[] }) {
  const relevant = cells.filter(
    (cell) => cell.deltaPp != null && Math.abs(cell.deltaPp) >= MIN_RELEVANT_PP,
  );
  if (relevant.length === 0) return null;

  const visible = relevant.slice(0, VISIBLE_LIMIT);
  const hidden = relevant.length - visible.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-muted-foreground" />
          Movimiento por generación
        </CardTitle>
        <CardDescription>
          El mismo nivel y asignatura, contra la generación anterior en el mismo instrumento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.map((cell) => {
          const delta = cell.deltaPp!;
          const dropped = delta < 0;
          const Icon = dropped ? TrendingDown : TrendingUp;
          return (
            <div
              key={`${cell.gradeId ?? '-'}-${cell.subjectId ?? '-'}`}
              className={`flex flex-col gap-2 rounded-md border-l-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                dropped
                  ? 'border-l-destructive bg-destructive/10'
                  : 'border-l-success bg-success/10'
              }`}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-foreground">
                  <span>
                    {[cell.gradeName, cell.subjectName].filter(Boolean).join(' · ') ||
                      'Sin clasificar'}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 ${
                      dropped ? 'text-destructive' : 'text-success'
                    }`}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    {dropped ? '' : '+'}
                    {delta.toFixed(1)} pp
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatAchievement(cell.achievement)} en {cell.year ?? 'este año'} ·{' '}
                  {formatAchievement(cell.baselineAchievement)} en{' '}
                  {cell.baselineYear ?? 'el anterior'} · {cell.studentsAssessed} alumnos
                </p>
              </div>
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link href={comparisonHref(cell)}>
                  Comparar
                  <ArrowRight className="ml-1.5 size-3.5" />
                </Link>
              </Button>
            </div>
          );
        })}
        {hidden > 0 ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {hidden} {hidden === 1 ? 'generación más se movió' : 'generaciones más se movieron'} en
            el alcance actual.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
