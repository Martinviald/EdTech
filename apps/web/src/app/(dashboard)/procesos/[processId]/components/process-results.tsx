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
import { AlertCallout } from '@/components/shared/AlertCallout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

const SEVERITY_CELL: Record<UnitSeverity, string> = {
  high: 'bg-destructive/10 text-destructive border-destructive/25',
  medium: 'bg-warning/15 text-warning border-warning/25',
  low: 'bg-success/10 text-success border-transparent',
};

const NEUTRAL_BAND = '#94a3b8';

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
  // `/coverage` no recorta por alcance docente: su denominador es el del colegio
  // entero. Compararlo contra un numerador ya recortado daría siempre un cociente
  // bajo el piso, y el profesor no vería nunca el titular. Con alcance docente se
  // muestra el titular sin denominador, que es lo honesto: su propio denominador
  // no existe todavía.
  const orgScoped = comparable.scope === 'org';
  const rollup = deriveProcessRollup(comparable.units, orgScoped ? coverage : null);
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
            {orgScoped ? ` · ${loadedCells} de ${expectedCells} celdas` : ' en tus cursos'}
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
                        background: bucket.color ?? NEUTRAL_BAND,
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
          <CardTitle className="text-base">Dónde se concentra el nivel más bajo</CardTitle>
          <CardDescription>
            Cada celda es un cruce de curso y asignatura: la distribución de sus clasificaciones por
            nivel, con los mismos colores de la barra de arriba. No es % de logro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ResultsMatrix rollup={rollup} processId={processId} />
          {coverage && coverage.unexpectedCells.length > 0 && (
            <UnexpectedCells coverage={coverage} />
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-sm">
        Las alertas de este proceso y el movimiento de cada celda se leen en el{' '}
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

  // Con una sola fila o una sola columna la matriz es una lista disfrazada, y la
  // tabla de unidades del panorama ya ordena mejor que esto.
  if (rollup.matrix.grades.length < 2 || rollup.matrix.subjects.length < 2) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th scope="col" className="text-muted-foreground px-2 text-left text-xs font-medium">
              Curso
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

  const ladder = cell.ladders.length === 1 ? cell.ladders[0] : null;
  const detail = ladder
    ? ladder.buckets.map((b) => `${b.label}: ${b.classifications}`).join(' · ')
    : undefined;

  const content = (
    <span
      className={cn(
        'flex min-h-11 flex-col justify-center gap-1 rounded-md border px-2 py-1.5 text-center',
        tone,
      )}
      title={detail}
    >
      {ladder && cell.lowestBand ? (
        <>
          {/* La distribución, con los mismos colores de la barra del titular. Un
              número suelto acá se lee como % de logro —donde más es mejor— y la
              lectura es la inversa: el verde bajo sería una catástrofe. */}
          <span className="flex h-1.5 overflow-hidden rounded-full">
            {ladder.buckets.map((bucket) => (
              <span
                key={bucket.key}
                style={{
                  width: `${bucket.percentage}%`,
                  background: bucket.color ?? NEUTRAL_BAND,
                }}
              />
            ))}
          </span>
          {/* Una fracción de alumnos no se confunde con un porcentaje de logro. */}
          <span className="text-2xs tabular-nums">
            {cell.lowestBand.classifications} de {cell.lowestBand.of}
          </span>
        </>
      ) : cell.ladders.length > 1 ? (
        // Escaleras distintas en la misma celda: sumar sus ordinales es lo que D2
        // prohíbe, así que no hay un número que mostrar.
        <span className="text-2xs">{cell.unitKeys.length} instrumentos</span>
      ) : (
        <span className="text-2xs">
          {hasUnit ? 'sin niveles' : COVERAGE_LABEL[cell.coverage ?? 'missing']}
        </span>
      )}
    </span>
  );

  if (cell.assessmentIds.length === 0) return content;
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
