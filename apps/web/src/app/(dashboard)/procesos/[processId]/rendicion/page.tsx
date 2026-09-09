import { Suspense } from 'react';
import { LayoutGrid } from 'lucide-react';
import { CardSkeleton, EmptyState } from '@/components/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getProcessCoverage } from '../../data';
import { CoverageBar } from '../../components/coverage-bar';
import { CoverageLegend, CoverageMatrix } from '../components/coverage-matrix';

export const dynamic = 'force-dynamic';

export default async function ProcesoRendicionPage({
  params,
}: {
  params: Promise<{ processId: string }>;
}) {
  const { processId } = await params;

  return (
    <Suspense fallback={<CardSkeleton rows={6} />}>
      <RendicionSection processId={processId} />
    </Suspense>
  );
}

async function RendicionSection({ processId }: { processId: string }) {
  const coverage = await getProcessCoverage(processId);

  if (!coverage.scopeDefined && coverage.unexpectedCells.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Sin alcance declarado"
        description="La rendición compara lo aplicado contra lo que debía aplicarse. Declara los cursos y asignaturas del proceso para poder medirla."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rendición por curso y asignatura</CardTitle>
          <CardDescription>
            {coverage.scopeDefined
              ? `${coverage.totals.complete} de ${coverage.totals.expected} celdas completas · ${coverage.totals.missing} sin evaluación · ${coverage.totals.partial} con carga incompleta`
              : 'Este proceso no declara alcance: se muestran sólo las celdas con datos.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {coverage.scopeDefined && <CoverageBar totals={coverage.totals} showLegend />}
          <CoverageLegend />
          <CoverageMatrix cells={coverage.cells} />
        </CardContent>
      </Card>

      {coverage.unexpectedCells.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Fuera del alcance declarado</CardTitle>
            <CardDescription>
              Celdas con datos que no figuran entre los cursos y asignaturas del proceso. O sobra la
              evaluación, o falta declararla en el alcance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CoverageMatrix cells={coverage.unexpectedCells} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
