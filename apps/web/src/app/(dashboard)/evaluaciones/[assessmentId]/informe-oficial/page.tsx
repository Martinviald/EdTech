import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  OFFICIAL_REPORT_VIEWER_ROLES,
  type OfficialCourseReportResponse,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import { EmptyState } from '@/components/patterns';
import { CourseReport } from '@/components/official-reports/course-report';
import { PrintToolbar } from '@/components/official-reports/print-toolbar';
import { DashboardFilterBar } from '../../../resultados/components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
} from '../../../resultados/components/dashboard-filters';

export const dynamic = 'force-dynamic';

/**
 * TKT-24 — Informe oficial por curso. Vive como pestaña del hub de evaluación.
 * El filtro de curso (DashboardFilterBar) acota el informe a un `classGroupId`.
 * El scoping (profesor sólo sus cursos) lo aplica el backend.
 */
export default async function InformeOficialPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, OFFICIAL_REPORT_VIEWER_ROLES)) redirect('/dashboard');

  const { assessmentId } = await params;
  const sp = await searchParams;
  const filters = parseDashboardFilters(sp);
  const filterQuery = buildDashboardQuery(filters);
  const classGroupId = filters.classGroupId;
  const basePath = `/evaluaciones/${assessmentId}/informe-oficial`;

  const reportQuery = new URLSearchParams({ assessmentId });
  if (classGroupId) reportQuery.set('classGroupId', classGroupId);

  const [options, report] = await Promise.all([
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${filterQuery}`),
    apiGet<OfficialCourseReportResponse>(
      `/reports/course?${reportQuery.toString()}`,
    ).catch((): OfficialCourseReportResponse | null => null),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DashboardFilterBar options={options} value={filters} basePath={basePath} />
        {report ? <PrintToolbar /> : null}
      </div>

      {report ? (
        <CourseReport
          report={report}
          studentReportBasePath={`/evaluaciones/${assessmentId}/informe-alumno`}
        />
      ) : (
        <EmptyState
          icon={Inbox}
          title="No se pudo generar el informe oficial"
          description="No hay resultados para el curso seleccionado o no tienes acceso. Ajusta el filtro de curso o verifica tus cursos asignados."
        />
      )}
    </div>
  );
}
