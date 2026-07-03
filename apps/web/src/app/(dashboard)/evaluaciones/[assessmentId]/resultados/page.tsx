import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  ANALYTICS_VIEWER_ROLES,
  type AssessmentReportResponse,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import { EmptyState } from '@/components/patterns';
import { DashboardFilterBar } from '../../../resultados/components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
} from '../../../resultados/components/dashboard-filters';
import { ReportBody } from '../../../resultados/informe/report-body';

export const dynamic = 'force-dynamic';

export default async function EvaluacionResultadosPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ANALYTICS_VIEWER_ROLES)) redirect('/dashboard');

  const { assessmentId } = await params;
  const sp = await searchParams;
  const filters = parseDashboardFilters(sp);
  const filterQuery = buildDashboardQuery(filters);
  const classGroupId = filters.classGroupId;
  const basePath = `/evaluaciones/${assessmentId}/resultados`;

  const reportQuery = new URLSearchParams({ assessmentId });
  if (classGroupId) reportQuery.set('classGroupId', classGroupId);

  const [options, reportResult] = await Promise.all([
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${filterQuery}`),
    apiGet<AssessmentReportResponse>(
      `/analytics/assessment-report?${reportQuery.toString()}`,
    ).catch((): AssessmentReportResponse | null => null),
  ]);

  return (
    <div className="space-y-6">
      <DashboardFilterBar options={options} value={filters} basePath={basePath} />

      {reportResult ? (
        <ReportBody report={reportResult} />
      ) : (
        <EmptyState
          icon={Inbox}
          title="No se pudo generar el informe"
          description="No hay resultados para el curso seleccionado o no tienes acceso. Ajusta el filtro de curso o verifica tus cursos asignados."
        />
      )}
    </div>
  );
}
