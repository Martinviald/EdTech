import { Suspense } from 'react';
import Link from 'next/link';
import { ClipboardList, LayoutGrid, TriangleAlert, Users } from 'lucide-react';
import { AlertCallout, CardSkeleton, KpiGridSkeleton, StatCard } from '@/components/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';
import { getProcess, getProcessCoverage } from '../data';
import { CoverageBar } from '../components/coverage-bar';

export const dynamic = 'force-dynamic';

export default async function ProcesoResumenPage({
  params,
}: {
  params: Promise<{ processId: string }>;
}) {
  const { processId } = await params;

  return (
    <div className="space-y-6">
      <Suspense fallback={<KpiGridSkeleton count={3} />}>
        <ResumenSection processId={processId} />
      </Suspense>
      <Suspense fallback={<CardSkeleton rows={4} />}>
        <AccesosDirectosSection processId={processId} />
      </Suspense>
    </div>
  );
}

async function ResumenSection({ processId }: { processId: string }) {
  const process = await getProcess(processId);
  const coverage = process.coverage;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Cobertura"
          value={coverage ? `${coverage.complete}/${coverage.expected}` : 'Sin alcance'}
          hint={coverage ? 'celdas completas' : 'declara cursos y asignaturas'}
          icon={LayoutGrid}
        />
        <StatCard
          label="Evaluaciones"
          value={String(process.assessmentCount)}
          hint="asociadas al proceso"
          icon={ClipboardList}
        />
        <StatCard
          label="Alumnos evaluados"
          value={String(process.studentsAssessed)}
          hint="con resultados calculados"
          icon={Users}
        />
      </div>

      {coverage && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Avance de la rendición</CardTitle>
            <CardDescription>
              {coverage.missing > 0
                ? `Faltan ${coverage.missing} de ${coverage.expected} celdas por aplicar.`
                : 'Todas las celdas esperadas tienen su evaluación.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CoverageBar totals={coverage} showLegend />
            <Link
              href={ROUTES.procesoRendicion(process.id)}
              className="text-primary text-sm hover:underline"
            >
              Ver la matriz completa
            </Link>
          </CardContent>
        </Card>
      )}

      {process.scopeDerived && (
        <AlertCallout tone="warning" title="Alcance derivado de los datos ya cargados">
          Este proceso se reconstruyó a partir de las evaluaciones existentes, así que su cobertura
          siempre da completa. Declara los cursos y asignaturas que corresponden para que el
          denominador mida algo.
        </AlertCallout>
      )}

      {!process.scopeDefined && (
        <AlertCallout tone="info" title="Sin alcance declarado">
          Define qué cursos y asignaturas debe cubrir este proceso para poder seguir su rendición.
        </AlertCallout>
      )}
    </div>
  );
}

async function AccesosDirectosSection({ processId }: { processId: string }) {
  const coverage = await getProcessCoverage(processId);
  const withAssessment = [...coverage.cells, ...coverage.unexpectedCells].filter(
    (cell) => cell.assessmentId !== null,
  );

  if (withAssessment.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Accesos directos</CardTitle>
          <CardDescription>Todavía no hay evaluaciones asociadas a este proceso.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const seen = new Set<string>();
  const assessments = withAssessment.filter((cell) => {
    if (seen.has(cell.assessmentId as string)) return false;
    seen.add(cell.assessmentId as string);
    return true;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Accesos directos</CardTitle>
        <CardDescription>Las evaluaciones de este proceso, una por celda aplicada.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {coverage.unexpectedCells.length > 0 && (
          <AlertCallout tone="warning" title="Evaluaciones fuera del alcance declarado">
            <span className="flex items-center gap-1.5">
              <TriangleAlert className="size-4" aria-hidden />
              {coverage.unexpectedCells.length} celda(s) con datos no figuran en los cursos y
              asignaturas declarados del proceso.
            </span>
          </AlertCallout>
        )}
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {assessments.map((cell) => (
            <li key={cell.assessmentId}>
              <Link
                href={ROUTES.evaluacion(cell.assessmentId as string)}
                className="hover:border-primary/40 block rounded-md border px-3 py-2 transition-colors"
              >
                <span className="block text-sm font-medium">
                  {cell.assessmentName ?? `${cell.subjectName} ${cell.classGroupName}`}
                </span>
                <span className="text-muted-foreground text-xs">
                  {cell.gradeShortName} {cell.classGroupName} · {cell.subjectName}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
