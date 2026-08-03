import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  ANALYTICS_VIEWER_ROLES,
  type AssessmentReportResponse,
  type DashboardSkillsResponse,
} from '@soe/types';
import { EmptyState } from '@/components/shared';
import { ReportBody } from '../../../resultados/informe/report-body';
import { AssessmentCourseFilter } from '../components/course-filter';
import { getAssessmentCourses, pickParam } from '../data';

export const dynamic = 'force-dynamic';

export default async function EvaluacionResultadosPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ANALYTICS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { assessmentId } = await params;
  const sp = await searchParams;
  // El informe por-evaluación se acota a UN curso de los que la rindieron.
  const classGroupId = pickParam(sp.classGroupId);
  const basePath = ROUTES.evaluacionResultados(assessmentId);

  const reportQuery = new URLSearchParams({ assessmentId });
  if (classGroupId) reportQuery.set('classGroupId', classGroupId);

  // TKT-11/TKT-10: todos los nodos evaluados (habilidad/contenido/OA/eje) para el
  // desglose por dimensión + drill-down; acotado a esta evaluación y curso.
  const skillsQuery = new URLSearchParams({ assessmentId });
  if (classGroupId) skillsQuery.set('classGroupId', classGroupId);

  const [courses, reportResult, skillsResult] = await Promise.all([
    getAssessmentCourses(assessmentId),
    apiGet<AssessmentReportResponse>(
      `/analytics/assessment-report?${reportQuery.toString()}`,
    ).catch((): AssessmentReportResponse | null => null),
    apiGet<DashboardSkillsResponse>(`/dashboards/skills?${skillsQuery.toString()}`).catch(
      (): DashboardSkillsResponse | null => null,
    ),
  ]);

  return (
    <div className="space-y-6">
      <AssessmentCourseFilter courses={courses} value={classGroupId} basePath={basePath} />

      {reportResult ? (
        <ReportBody
          report={reportResult}
          skillsBreakdown={skillsResult?.skills}
          assessmentId={assessmentId}
          classGroupId={classGroupId}
        />
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
