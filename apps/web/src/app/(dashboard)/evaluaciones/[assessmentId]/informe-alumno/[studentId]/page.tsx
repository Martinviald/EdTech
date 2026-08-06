import { Suspense } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { ArrowLeft, Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  OFFICIAL_REPORT_VIEWER_ROLES,
  type OfficialStudentReportResponse,
} from '@soe/types';
import { EmptyState, CardSkeleton } from '@/components/shared';
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
type Back = { href: Route; label: string };

export default async function InformeAlumnoPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string; studentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, OFFICIAL_REPORT_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { assessmentId, studentId } = await params;
  const { volver } = await searchParams;
  const back: Back =
    volver === 'estudiante'
      ? { href: ROUTES.estudiante(studentId), label: 'Volver al panorama del alumno' }
      : {
          href: ROUTES.evaluacionInformeOficial(assessmentId),
          label: 'Volver al informe del curso',
        };

  return (
    <Suspense fallback={<InformeAlumnoSkeleton back={back} />}>
      <InformeAlumnoContent assessmentId={assessmentId} studentId={studentId} back={back} />
    </Suspense>
  );
}

function BackLink({ back }: { back: Back }) {
  return (
    <Link
      href={back.href}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {back.label}
    </Link>
  );
}

function InformeAlumnoSkeleton({ back }: { back: Back }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <BackLink back={back} />
      </div>
      <CardSkeleton rows={6} />
    </div>
  );
}

async function InformeAlumnoContent({
  assessmentId,
  studentId,
  back,
}: {
  assessmentId: string;
  studentId: string;
  back: Back;
}) {
  const query = new URLSearchParams({ assessmentId, studentId });
  const report = await apiGet<OfficialStudentReportResponse>(
    `/reports/student?${query.toString()}`,
  ).catch((): OfficialStudentReportResponse | null => null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <BackLink back={back} />
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
