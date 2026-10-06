import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { canSeeBenchmark, getInstrumentSample, getItemSampleRates } from '@/lib/benchmark-samples';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  OFFICIAL_REPORT_VIEWER_ROLES,
  sampleSizeLabel,
  type OfficialCourseReportResponse,
} from '@soe/types';
import { EmptyState, SampleDeltaChip } from '@/components/shared';
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
        canSeeBenchmark(session.user.roles) ? (
          <Suspense fallback={courseReport(report, classGroupId, assessmentId, true, null)}>
            <CourseReportWithItemSamples
              report={report}
              classGroupId={classGroupId}
              assessmentId={assessmentId}
            />
          </Suspense>
        ) : (
          courseReport(report, classGroupId, assessmentId, false, null)
        )
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

async function CourseReportSampleLine({
  instrumentId,
  instrumentName,
  value,
  subject,
}: {
  instrumentId: string;
  instrumentName: string;
  value: number | null;
  subject: 'school' | 'course';
}) {
  const entry = await getInstrumentSample(instrumentId);
  const global = entry?.global;
  if (!entry || !global) return null;
  const totalInBands = global.bandCounts.reduce((acc, band) => acc + band.count, 0);
  const bands =
    totalInBands > 0
      ? global.bandCounts
          .map((band) => `${band.label} ${((band.count / totalInBands) * 100).toFixed(0)}%`)
          .join(' · ')
      : null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground print:hidden">
      <span>
        Muestra de colegios:{' '}
        {global.avgAchievement === null ? '—' : `${global.avgAchievement.toFixed(1)}%`} de logro
        {bands ? ` · ${bands}` : ''} · {sampleSizeLabel(global)}
      </span>
      <SampleDeltaChip
        entry={entry}
        value={value}
        subject={subject}
        instrumentName={instrumentName}
        surface="evaluacion.informe-oficial"
      />
    </div>
  );
}

function courseReport(
  report: OfficialCourseReportResponse,
  classGroupId: string | undefined,
  assessmentId: string,
  canSeeSample: boolean,
  itemSamples: ReadonlyMap<string, number | null> | null,
) {
  return (
    <CourseReport
      report={report}
      studentReportBasePath={ROUTES.evaluacionInformeAlumnoBase(assessmentId)}
      itemSamples={itemSamples}
      generalSample={
        canSeeSample ? (
          <Suspense fallback={null}>
            <CourseReportSampleLine
              instrumentId={report.meta.instrumentId}
              instrumentName={report.meta.instrumentName}
              value={report.generalResult.averageAchievement}
              subject={classGroupId ? 'course' : 'school'}
            />
          </Suspense>
        ) : undefined
      }
    />
  );
}

async function CourseReportWithItemSamples({
  report,
  classGroupId,
  assessmentId,
}: {
  report: OfficialCourseReportResponse;
  classGroupId: string | undefined;
  assessmentId: string;
}) {
  const itemSamples = await getItemSampleRates(report.meta.instrumentId);
  return courseReport(report, classGroupId, assessmentId, true, itemSamples);
}
