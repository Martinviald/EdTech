import { redirect } from 'next/navigation';
import { Inbox, Table2, Users } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { asCapabilityUnavailable } from '@/lib/errors';
import { assessmentSupports } from '@/lib/assessment-capabilities';
import {
  canAccess,
  capabilityUnavailableMessage,
  ITEM_ANALYSIS_VIEWER_ROLES,
  type DashboardFilterOptionsResponse,
  type ItemMatrixResponse,
} from '@soe/types';
import { EmptyState } from '@/components/patterns';
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
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_ANALYSIS_VIEWER_ROLES)) redirect('/dashboard');

  const { assessmentId } = await params;
  const sp = await searchParams;
  const filters = parseDashboardFilters(sp);
  const filterQuery = buildDashboardQuery(filters);
  const classGroupId = filters.classGroupId;
  const basePath = `/evaluaciones/${assessmentId}/detalle`;

  // TKT-09 — el ordenamiento (alumnos/preguntas por % de logro) se resuelve en el
  // cliente, por lo que se pide el curso COMPLETO sin paginar (`all=true`).
  const matrixQuery = new URLSearchParams({ assessmentId, all: 'true' });
  if (classGroupId) matrixQuery.set('classGroupId', classGroupId);

  const [options, matrixResult, hasStudentMatrix] = await Promise.all([
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${filterQuery}`),
    apiGet<ItemMatrixResponse>(`/item-analysis/matrix?${matrixQuery.toString()}`)
      .then((matrix) => ({ matrix, unavailableReason: null as string | null }))
      .catch((error: unknown) => ({
        matrix: null,
        // 409 del `CapabilityGuard` ⇒ "no aplica" con motivo, no un fallo.
        unavailableReason: asCapabilityUnavailable(error)?.message ?? null,
      })),
    // Una evaluación cargada desde un informe oficial trae los agregados por
    // pregunta pero no las respuestas de cada alumno: la matriz sale sin filas y
    // el motivo NO es "aún no cargan respuestas", es el origen del dato.
    assessmentSupports(assessmentId, 'student_matrix'),
  ]);

  const { matrix, unavailableReason } = matrixResult;

  return (
    <div className="space-y-6">
      <DashboardFilterBar options={options} value={filters} basePath={basePath} />

      {!matrix ? (
        <EmptyState
          icon={unavailableReason ? Users : Inbox}
          title={
            unavailableReason
              ? 'Esta evaluación no tiene respuestas por estudiante'
              : 'No se pudo cargar la tabla cruzada'
          }
          description={
            unavailableReason ??
            'No hay respuestas para el curso seleccionado o no tienes acceso. Ajusta el filtro de curso o verifica tus cursos asignados.'
          }
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
            {matrix.questions.length === 0 ? (
              <EmptyState
                icon={Table2}
                title="Sin respuestas para mostrar"
                description="Esta evaluación aún no tiene preguntas en su instrumento."
              />
            ) : hasStudentMatrix ? (
              <EmptyState
                icon={Table2}
                title="Sin respuestas para mostrar"
                description="No hay alumnos con respuestas registradas en esta evaluación dentro de tu alcance."
              />
            ) : (
              // El caso que antes mentía: decía "sin respuestas registradas"
              // (suena a carga pendiente) cuando la causa real es el origen del
              // dato y no hay nada que cargar. El texto lo pone el backend.
              <EmptyState
                icon={Users}
                title="Esta evaluación no tiene respuestas por estudiante"
                description={capabilityUnavailableMessage('student_matrix')}
              />
            )}
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
