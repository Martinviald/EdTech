import { redirect } from 'next/navigation';
import { Inbox, Table2 } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  ITEM_ANALYSIS_VIEWER_ROLES,
  type DashboardFilterOptionsResponse,
  type ItemMatrixResponse,
} from '@soe/types';
import { EmptyState } from '@/components/shared';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardFilterBar } from '../../../resultados/components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
} from '../../../resultados/components/dashboard-filters';
import { CrossTable } from '../../../resultados/detalle/cross-table';

export const dynamic = 'force-dynamic';

export default async function EvaluacionDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_ANALYSIS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { assessmentId } = await params;
  const sp = await searchParams;
  const filters = parseDashboardFilters(sp);
  const filterQuery = buildDashboardQuery(filters);
  const classGroupId = filters.classGroupId;
  const basePath = ROUTES.evaluacionDetalle(assessmentId);

  // TKT-09 — el ordenamiento (alumnos/preguntas por % de logro) se resuelve en el
  // cliente, por lo que se pide el curso COMPLETO sin paginar (`all=true`).
  const matrixQuery = new URLSearchParams({ assessmentId, all: 'true' });
  if (classGroupId) matrixQuery.set('classGroupId', classGroupId);

  const [options, matrix] = await Promise.all([
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${filterQuery}`),
    apiGet<ItemMatrixResponse>(`/item-analysis/matrix?${matrixQuery.toString()}`).catch(
      (): ItemMatrixResponse | null => null,
    ),
  ]);

  return (
    <div className="space-y-6">
      <DashboardFilterBar options={options} value={filters} basePath={basePath} />

      {!matrix ? (
        <EmptyState
          icon={Inbox}
          title="No se pudo cargar la tabla cruzada"
          description="No hay respuestas para el curso seleccionado o no tienes acceso. Ajusta el filtro de curso o verifica tus cursos asignados."
        />
      ) : matrix.questions.length === 0 || matrix.students.total === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="space-y-0.5">
              <h2 className="text-base font-semibold">
                {matrix.assessmentName ?? matrix.instrumentName}
              </h2>
              <p className="text-sm text-muted-foreground">
                {matrix.instrumentName} · {matrix.questions.length} preguntas ·{' '}
                {matrix.students.total} alumnos
              </p>
            </div>
            <EmptyState
              icon={Table2}
              title="Sin respuestas para mostrar"
              description={
                matrix.students.total === 0
                  ? 'No hay alumnos con respuestas registradas en esta evaluación dentro de tu alcance.'
                  : 'Esta evaluación aún no tiene preguntas en su instrumento.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="space-y-0.5">
              <h2 className="text-base font-semibold">
                {matrix.assessmentName ?? matrix.instrumentName}
              </h2>
              <p className="text-sm text-muted-foreground">
                {matrix.instrumentName} · {matrix.questions.length} preguntas ·{' '}
                {matrix.students.total} alumnos
              </p>
            </div>
            <CrossTable matrix={matrix} assessmentId={assessmentId} classGroupId={classGroupId} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
