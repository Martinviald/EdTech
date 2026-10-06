import Link from 'next/link';
import type { Route } from 'next';
import { TriangleAlert } from 'lucide-react';
import {
  deriveProcessRollup,
  isHeadlineTrustworthy,
  type ComparableOverviewResponse,
  type ProcessCoverageResponse,
  type ProcessMatrixCell,
  type UnitSeverity,
} from '@soe/types';
import { AlertCallout } from '@/components/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

const SEVERITY_CELL: Record<UnitSeverity, string> = {
  high: 'bg-destructive/10 text-destructive border-destructive/25',
  medium: 'bg-warning/15 text-warning border-warning/25',
  low: 'bg-success/10 text-success border-transparent',
};

const COVERAGE_CELL = 'bg-muted/50 text-muted-foreground border-transparent';

const COVERAGE_LABEL: Record<string, string> = {
  missing: 'sin evaluación',
  scheduled: 'sin respuestas',
  partial: 'carga incompleta',
  complete: 'sin niveles',
};

function pct(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} %`;
}

function cellHref(cell: ProcessMatrixCell, processId: string): Route {
  if (cell.assessmentIds.length === 1) {
    return ROUTES.evaluacion(cell.assessmentIds[0] as string) as Route;
  }
  const params = new URLSearchParams({ processId });
  if (cell.gradeId) params.set('gradeId', cell.gradeId);
  if (cell.subjectId) params.set('subjectId', cell.subjectId);
  return `${ROUTES.resultados}?${params.toString()}` as Route;
}

/**
 * Los resultados del proceso, en el orden de la confianza: primero de qué
 * tamaño es el problema, después dónde está, después qué se movió y al final
 * qué hacer. El bloque de cobertura va antes que todo esto y vive en la página.
 *
 * No emite ningún % de logro del proceso: cuenta clasificaciones. Ver
 * `deriveProcessRollup` y docs/diseno-resultados-del-proceso.md.
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
  const rollup = deriveProcessRollup(comparable.units, coverage);
  const trustworthy = isHeadlineTrustworthy(rollup.totals);
  const loadedCells = coverage
    ? coverage.totals.complete
    : rollup.matrix.cells.filter((c) => c.unitKeys.length > 0).length;
  const expectedCells = coverage?.totals.expected ?? rollup.matrix.cells.length;

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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Clasificaciones por nivel</CardTitle>
          <CardDescription>
            {rollup.totals.classifications.toLocaleString('es-CL')} clasificaciones
            {rollup.totals.expectedClassifications
              ? ` sobre ${rollup.totals.expectedClassifications.toLocaleString('es-CL')} esperadas`
              : ''}{' '}
            · {loadedCells} de {expectedCells} celdas
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
                      de las clasificaciones quedó en{' '}
                      {ladder.bands[0]?.label ?? 'el nivel más bajo'}, el más bajo de cada prueba.
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
                        background: bucket.color ?? undefined,
                      }}
                      title={`${bucket.label}: ${bucket.classifications} clasificaciones`}
                    >
                      {bucket.percentage >= 10 ? pct(bucket.percentage) : ''}
                    </div>
                  ))}
                </div>
                <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {ladder.buckets.map((bucket) => (
                    <li key={bucket.key}>
                      {bucket.label}: {bucket.classifications.toLocaleString('es-CL')}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <AlertCallout
              tone="warning"
              title={`Medición en curso · ${loadedCells} de ${expectedCells} celdas`}
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

          <p className="text-muted-foreground text-xs">
            Cada alumno está clasificado con el corte de su propia prueba; por eso se cuentan
            alumnos y no se promedian porcentajes.
            {rollup.totals.unitsWithMeasuredCut != null &&
              ` Corte medido declarado en ${rollup.totals.unitsWithMeasuredCut} de ${rollup.totals.units} unidades.`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Nivel × asignatura</CardTitle>
          <CardDescription>
            Cada celda es una unidad comparable: el % de alumnos en el nivel más bajo de esa prueba.
            Los colores comparan concentración, nunca puntajes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ResultsMatrix rollup={rollup} processId={processId} />
          {coverage && coverage.unexpectedCells.length > 0 && (
            <UnexpectedCells coverage={coverage} />
          )}
        </CardContent>
      </Card>

      {comparable.generational.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Celdas que más retrocedieron</CardTitle>
            <CardDescription>
              Cada celda contra su propio comparable. El proceso no se compara contra otro proceso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {comparable.generational.slice(0, 5).map((item) => (
                <li
                  key={`${item.subjectId ?? '-'}-${item.gradeId ?? '-'}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
                >
                  <span className="font-medium">
                    {item.subjectName ?? '—'} · {item.gradeName ?? '—'}
                  </span>
                  <span className="text-destructive font-medium tabular-nums">
                    {item.deltaPp != null ? `${item.deltaPp.toFixed(1).replace('.', ',')} pp` : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {comparable.alerts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lo más urgente</CardTitle>
            <CardDescription>{comparable.alertsTotal} alerta(s) en este proceso.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {comparable.alerts.slice(0, 3).map((alert) => (
              <div
                key={alert.dedupKey}
                className={cn(
                  'rounded-md border-l-2 px-3 py-2 text-sm',
                  alert.severity === 'high'
                    ? 'border-destructive bg-destructive/5'
                    : 'border-warning bg-warning/5',
                )}
              >
                <p>{alert.message}</p>
                {alert.unitLabel && (
                  <p className="text-muted-foreground text-xs">{alert.unitLabel}</p>
                )}
              </div>
            ))}
            <Link
              href={`${ROUTES.resultados}?processId=${processId}` as Route}
              className="text-primary inline-block text-sm hover:underline"
            >
              Ver las {comparable.alertsTotal} en el panorama →
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultsMatrix({
  rollup,
  processId,
}: {
  rollup: ReturnType<typeof deriveProcessRollup>;
  processId: string;
}) {
  const byKey = new Map(
    rollup.matrix.cells.map((c) => [`${c.gradeId ?? '-'}::${c.subjectId ?? '-'}`, c]),
  );

  if (rollup.matrix.grades.length === 0 || rollup.matrix.subjects.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th scope="col" className="text-muted-foreground px-2 text-left text-xs font-medium">
              Nivel
            </th>
            {rollup.matrix.subjects.map((subject) => (
              <th
                key={subject.id}
                scope="col"
                className="text-muted-foreground px-2 text-center text-xs font-medium"
              >
                {subject.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rollup.matrix.grades.map((grade) => (
            <tr key={grade.id}>
              <th scope="row" className="px-2 text-left font-medium whitespace-nowrap">
                {grade.name}
              </th>
              {rollup.matrix.subjects.map((subject) => {
                const cell = byKey.get(`${grade.id}::${subject.id}`);
                if (!cell) return <td key={subject.id} className="p-0" />;
                return (
                  <td key={subject.id} className="p-0">
                    <MatrixCell cell={cell} processId={processId} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixCell({ cell, processId }: { cell: ProcessMatrixCell; processId: string }) {
  const hasUnit = cell.unitKeys.length > 0;
  const tone = hasUnit && cell.severity ? SEVERITY_CELL[cell.severity] : COVERAGE_CELL;

  const content = (
    <span
      className={cn(
        'flex min-h-11 flex-col justify-center rounded-md border px-2 py-1.5 text-center',
        tone,
      )}
    >
      {hasUnit && cell.lowestBandShare != null ? (
        <>
          <span className="text-sm font-semibold tabular-nums">{pct(cell.lowestBandShare)}</span>
          <span className="text-2xs opacity-80">n={cell.classifications}</span>
        </>
      ) : (
        <span className="text-2xs">
          {hasUnit ? 'sin niveles' : COVERAGE_LABEL[cell.coverage ?? 'missing']}
        </span>
      )}
    </span>
  );

  if (!hasUnit) return content;
  return (
    <Link
      href={cellHref(cell, processId)}
      className="focus-visible:ring-ring block rounded-md focus-visible:ring-2 focus-visible:outline-none"
    >
      {content}
    </Link>
  );
}

function UnexpectedCells({ coverage }: { coverage: ProcessCoverageResponse }) {
  const seen = new Set<string>();
  const assessments = coverage.unexpectedCells.filter((cell) => {
    if (!cell.assessmentId || seen.has(cell.assessmentId)) return false;
    seen.add(cell.assessmentId);
    return true;
  });

  return (
    <AlertCallout tone="warning" title="Evaluaciones fuera del alcance declarado">
      <span className="flex items-start gap-1.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {coverage.unexpectedCells.length} celda(s) con datos no figuran entre los cursos y
          asignaturas declarados. O sobra la evaluación, o falta declararla en el alcance.
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {assessments.map((cell) => (
              <Link
                key={cell.assessmentId}
                href={ROUTES.evaluacion(cell.assessmentId as string)}
                className="text-primary text-xs hover:underline"
              >
                {cell.gradeShortName} {cell.classGroupName} · {cell.subjectName}
              </Link>
            ))}
          </span>
        </span>
      </span>
    </AlertCallout>
  );
}
