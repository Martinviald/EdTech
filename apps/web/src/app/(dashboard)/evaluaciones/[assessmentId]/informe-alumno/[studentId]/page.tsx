import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { ArrowLeft, Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  OFFICIAL_REPORT_VIEWER_ROLES,
  type OfficialStudentReportResponse,
} from '@soe/types';
import { EmptyState } from '@/components/patterns';
import { StudentReport } from '@/components/official-reports/student-report';
import { PrintToolbar } from '@/components/official-reports/print-toolbar';

export const dynamic = 'force-dynamic';

/**
 * TKT-26 — Informe individual del estudiante por evaluación. Se llega desde la
 * tabla de estudiantes del informe oficial por curso (TKT-24). SÓLO generación:
 * el envío por correo al apoderado queda diferido a una fase posterior.
 *
 * Vive bajo el layout del hub de evaluación (hereda cabecera y sub-navegación).
 * Contiene PII (RUT, nombre): el scoping (un profesor sólo ve alumnos de sus
 * cursos) lo aplica el backend; aquí sólo se verifica el rol de acceso.
 */
export default async function InformeAlumnoPage({
  params,
}: {
  params: Promise<{ assessmentId: string; studentId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, OFFICIAL_REPORT_VIEWER_ROLES)) redirect('/dashboard');

  const { assessmentId, studentId } = await params;
  const backHref = `/evaluaciones/${assessmentId}/informe-oficial` as Route;

  const query = new URLSearchParams({ assessmentId, studentId });
  const report = await apiGet<OfficialStudentReportResponse>(
    `/reports/student?${query.toString()}`,
  ).catch((): OfficialStudentReportResponse | null => null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Volver al informe del curso
        </Link>
        {report ? <PrintToolbar /> : null}
      </div>

      {report ? (
        <StudentReport report={report} />
      ) : (
        <EmptyState
          icon={Inbox}
          title="No se pudo generar el informe del estudiante"
          description="No hay resultados para este estudiante en la evaluación seleccionada, o no tienes acceso a su curso."
        />
      )}
    </div>
  );
}
