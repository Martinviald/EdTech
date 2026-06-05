import { redirect } from 'next/navigation';
import { ClipboardList, Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  ANALYTICS_VIEWER_ROLES,
  type AssessmentListResponse,
  type AssessmentOption,
  type AssessmentReportResponse,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { DashboardFilterBar } from '../components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
} from '../components/dashboard-filters';
import { ResultadosNav } from '../components/resultados-nav';
import { AssessmentSelect } from '../detalle/assessment-select';
import { ReportBody } from './report-body';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/resultados/informe';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

export default async function InformeEvaluacionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ANALYTICS_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const filterQuery = buildDashboardQuery(filters);
  const assessmentId = pickParam(params.assessmentId);
  const classGroupId = filters.classGroupId;

  // Opciones de filtro + evaluaciones disponibles (ambas acotadas por filtros y
  // por el scope del usuario), para poblar el filter bar y el selector.
  const [options, assessmentList] = await Promise.all([
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${filterQuery}`),
    apiGet<AssessmentListResponse>(`/item-analysis/assessments${filterQuery}`),
  ]);

  let report: AssessmentReportResponse | null = null;
  let reportError = false;
  if (assessmentId) {
    try {
      const query = new URLSearchParams();
      query.set('assessmentId', assessmentId);
      if (classGroupId) query.set('classGroupId', classGroupId);
      report = await apiGet<AssessmentReportResponse>(
        `/analytics/assessment-report?${query.toString()}`,
      );
    } catch {
      reportError = true;
    }
  }

  // La evaluación seleccionada debe aparecer en el selector aunque los filtros la
  // dejen fuera de la lista.
  const selectOptions: AssessmentOption[] = [...assessmentList.data];
  if (
    assessmentId &&
    report &&
    !selectOptions.some((o) => o.assessmentId === assessmentId)
  ) {
    selectOptions.unshift({
      assessmentId,
      name: report.meta.assessmentName,
      instrumentName: report.meta.instrumentName,
      instrumentType: report.meta.instrumentType,
      subjectName: report.meta.subjectName,
      gradeName: report.meta.gradeName,
      administeredAt: report.meta.administeredAt,
      studentsCount: report.summary.studentsEvaluated,
    });
  }

  return (
    <PageContainer>
      <PageHeader
        title="Informe de evaluación"
        description="Informe consolidado y accionable de una evaluación para el equipo directivo y UTP: síntesis ejecutiva, comparativa por curso, fortalezas y brechas, análisis psicométrico de ítems y recomendaciones (H6.13)."
      />

      <ResultadosNav />

      <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <AssessmentSelect
          options={selectOptions}
          value={assessmentId}
          basePath={BASE_PATH}
        />
      </div>

      {!assessmentId ? (
        <EmptyState
          icon={ClipboardList}
          title="Selecciona una evaluación"
          description="El informe se genera para una evaluación específica. Usa los filtros y el selector de arriba para elegir una evaluación con resultados."
        />
      ) : reportError || !report ? (
        <EmptyState
          icon={Inbox}
          title="No se pudo generar el informe"
          description="No tienes acceso a esta evaluación o no existe. Verifica que tengas asignados los cursos de la evaluación."
        />
      ) : (
        <ReportBody report={report} />
      )}
    </PageContainer>
  );
}
