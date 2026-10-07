import Link from 'next/link';
import type { Route } from 'next';
import {
  deriveProcessRollup,
  type ComparableOverviewResponse,
  type ProcessCoverageResponse,
} from '@soe/types';
import { coverageSummaryOf } from '@/components/procesos/band-view';
import { ProcessLevelHeadline } from '@/components/procesos/process-level-headline';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';

/**
 * Los resultados en la ficha del proceso: el titular por nivel y nada más.
 *
 * La matriz, el movimiento por celda y las alertas se leen en el panorama
 * filtrado por el proceso, que es donde viven con sus filtros, su tabla de
 * unidades y sus pestañas de análisis. Acá queda la cifra que se lee en tres
 * segundos junto al avance de la rendición, que es lo que D4 pide: el
 * denominador pegado al número.
 *
 * Ver la enmienda §14 de docs/diseno-resultados-del-proceso.md.
 */
export function ProcessResults({
  processId,
  comparable,
  coverage,
}: {
  processId: string;
  comparable: ComparableOverviewResponse;
  coverage: ProcessCoverageResponse | null;
}) {
  // `/coverage` no recorta por alcance docente: su denominador es el del colegio
  // entero. Compararlo contra un numerador ya recortado daría siempre un cociente
  // bajo el piso, y el profesor no vería nunca el titular. Con alcance docente se
  // muestra el titular sin denominador, que es lo honesto: su propio denominador
  // no existe todavía.
  const orgScoped = comparable.scope === 'org';
  const scopedCoverage = orgScoped ? coverage : null;
  const rollup = deriveProcessRollup(comparable.units, scopedCoverage);

  if (rollup.totals.classifications === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Resultados</CardTitle>
          <CardDescription>
            Todavía no hay resultados cargados en este proceso. Aparecerán acá a medida que se
            carguen las evaluaciones.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ProcessLevelHeadline
        rollup={rollup}
        coverageSummary={coverageSummaryOf(scopedCoverage, orgScoped)}
        compact
      />

      <p className="text-muted-foreground text-sm">
        Dónde se concentra el nivel más bajo, el movimiento de cada celda y las alertas de este
        proceso se leen en el{' '}
        <Link
          href={`${ROUTES.resultados}?processId=${processId}` as Route}
          className="text-primary hover:underline"
        >
          panorama filtrado por el proceso
        </Link>
        .
      </p>
    </div>
  );
}
