import { isHeadlineTrustworthy, type ProcessResultsRollup } from '@soe/types';
import { AlertCallout } from '@/components/shared/AlertCallout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NEUTRAL_BAND, pct } from './band-view';

/**
 * El titular por nivel de un proceso: cuántas clasificaciones quedaron en cada
 * banda, una barra por escalera (D2) y nunca un % de logro del proceso (D1).
 *
 * `coverageSummary` es obligatorio aunque sea nulo: D4 pide que el denominador
 * viaje con la síntesis, porque un proceso a medio cargar leído sin él se lee
 * como completo. Con alcance docente va en `null` a propósito —el denominador de
 * /coverage es el del colegio entero— y entonces la tarjeta dice "en tus cursos".
 *
 * `compact` deja fuera el desglose por banda y la nota de procedencia del corte:
 * son análisis, y en la ficha del proceso el titular es la cifra de tres
 * segundos. El aviso de medición en curso NO se oculta nunca.
 */
export function ProcessLevelHeadline({
  rollup,
  coverageSummary,
  compact = false,
}: {
  rollup: ProcessResultsRollup;
  coverageSummary: { loadedCells: number; expectedCells: number } | null;
  compact?: boolean;
}) {
  const trustworthy = isHeadlineTrustworthy(rollup.totals);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Clasificaciones por nivel</CardTitle>
        <CardDescription>
          {rollup.totals.classifications.toLocaleString('es-CL')} clasificaciones
          {rollup.totals.expectedClassifications
            ? ` sobre ${rollup.totals.expectedClassifications.toLocaleString('es-CL')} esperadas`
            : ''}{' '}
          {coverageSummary
            ? ` · ${coverageSummary.loadedCells} de ${coverageSummary.expectedCells} celdas`
            : ' en tus cursos'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {trustworthy ? (
          rollup.ladders.map((ladder) => (
            <div key={ladder.ladderKey} className="space-y-2">
              {rollup.ladders.length > 1 && (
                <p className="text-muted-foreground text-xs">
                  {ladder.units} instrumento(s) con niveles{' '}
                  {ladder.bands.map((b) => b.label).join(' · ')}
                </p>
              )}
              {ladder.lowestBandShare != null && (
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-destructive text-3xl font-semibold tabular-nums">
                    {pct(ladder.lowestBandShare)}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    de las clasificaciones quedó en {ladder.bands[0]?.label ?? 'el nivel más bajo'},
                    el más bajo de cada prueba.
                  </span>
                </p>
              )}
              <div className="flex h-6 overflow-hidden rounded-md">
                {ladder.buckets.map((bucket) => (
                  <div
                    key={bucket.key}
                    className="flex items-center justify-center text-2xs font-medium text-white"
                    style={{
                      width: `${bucket.percentage}%`,
                      background: bucket.color ?? NEUTRAL_BAND,
                    }}
                    title={`${bucket.label}: ${bucket.classifications} clasificaciones`}
                  >
                    {bucket.percentage >= 10 ? pct(bucket.percentage) : ''}
                  </div>
                ))}
              </div>
              {!compact && (
                <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {ladder.buckets.map((bucket) => (
                    <li key={bucket.key}>
                      {bucket.label}: {bucket.classifications.toLocaleString('es-CL')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        ) : (
          <AlertCallout
            tone="warning"
            title={`Medición en curso · ${coverageSummary?.loadedCells ?? 0} de ${coverageSummary?.expectedCells ?? 0} celdas`}
          >
            Con menos del 60 % de las clasificaciones cargadas no se muestra el titular por nivel:
            las celdas que faltan son justo las que lo moverían.
          </AlertCallout>
        )}

        {rollup.unclassified.units > 0 && (
          <p className="text-muted-foreground text-xs">
            {rollup.unclassified.classifications.toLocaleString('es-CL')} clasificaciones en{' '}
            {rollup.unclassified.units} instrumento(s) sin niveles configurados quedan fuera del
            conteo.
          </p>
        )}

        {!compact && (
          <p className="text-muted-foreground text-xs">
            Cada alumno está clasificado con el corte de su propia prueba; por eso se cuentan
            alumnos y no se promedian porcentajes.
            {rollup.totals.unitsWithMeasuredCut != null &&
              ` Corte medido declarado en ${rollup.totals.unitsWithMeasuredCut} de ${rollup.totals.units} unidades.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
