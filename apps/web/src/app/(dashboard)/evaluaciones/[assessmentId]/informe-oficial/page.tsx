import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  OFFICIAL_REPORT_VIEWER_ROLES,
  type OfficialCourseReportResponse,
} from '@soe/types';
import { EmptyState } from '@/components/shared';
import { CourseReport } from '@/components/official-reports/course-report';
import { PrintToolbar } from '@/components/official-reports/print-toolbar';
import { AssessmentCourseFilter } from '../components/course-filter';
import { getAssessmentCourses, pickParam } from '../data';

export const dynamic = 'force-dynamic';

/**
 * TKT-24 — Informe oficial por curso. Vive como pestaña del hub de evaluación.
 * El selector de curso acota el informe a un `classGroupId` entre los cursos que
 * rindieron la evaluación. El scoping (profesor sólo sus cursos) lo aplica el backend.
 */
export default async function InformeOficialPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, OFFICIAL_REPORT_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { assessmentId } = await params;
  const sp = await searchParams;
  // El informe oficial por-evaluación se acota a UN curso de los que la rindieron.
  const classGroupId = pickParam(sp.classGroupId);
  const basePath = ROUTES.evaluacionInformeOficial(assessmentId);

  const reportQuery = new URLSearchParams({ assessmentId });
  if (classGroupId) reportQuery.set('classGroupId', classGroupId);

  const [courses, report] = await Promise.all([
    getAssessmentCourses(assessmentId),
    apiGet<OfficialCourseReportResponse>(`/reports/course?${reportQuery.toString()}`).catch(
      (): OfficialCourseReportResponse | null => null,
    ),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <AssessmentCourseFilter courses={courses} value={classGroupId} basePath={basePath} />
        </div>
        {report ? <PrintToolbar /> : null}
      </div>

      {report ? (
        <CourseReport
          report={report}
          studentReportBasePath={ROUTES.evaluacionInformeAlumnoBase(assessmentId)}
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
