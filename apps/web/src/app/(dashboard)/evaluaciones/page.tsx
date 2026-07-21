import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, FileUp } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  ANSWER_SHEET_IMPORT_ROLES,
} from '@soe/types';
import {
  PageContainer,
  PageHeader,
  EmptyState,
  FilterBarSkeleton,
  TableSkeleton,
} from '@/components/shared';
import { Button } from '@/components/ui/button';
import { DashboardFilterBar } from '../resultados/components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
  type DashboardFilterValues,
} from '../resultados/components/dashboard-filters';
import { AssessmentList } from './components/assessment-list';
import { getEvaluacionesFilters, getEvaluacionesAssessments } from './data';

export const dynamic = 'force-dynamic';

const BASE_PATH = ROUTES.evaluaciones;

export default async function EvaluacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const filterQuery = buildDashboardQuery(filters);
  const canImport = canAccess(session.user.roles, ANSWER_SHEET_IMPORT_ROLES);

  return (
    <PageContainer>
      <PageHeader
        title="Evaluaciones"
        description="Todas las evaluaciones a tu alcance. Elige una para entrar a su hub: resumen, resultados, análisis IA, material remedial y calidad del instrumento, sin re-seleccionar la evaluación en cada vista."
      />

      <Suspense fallback={<FilterBarSkeleton />}>
        <FiltersSection filters={filters} query={filterQuery} />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <AssessmentsSection query={filterQuery} canImport={canImport} />
      </Suspense>
    </PageContainer>
  );
}

async function FiltersSection({
  filters,
  query,
}: {
  filters: DashboardFilterValues;
  query: string;
}) {
  const options = await getEvaluacionesFilters(query);
  return <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />;
}

async function AssessmentsSection({
  query,
  canImport,
}: {
  query: string;
  canImport: boolean;
}) {
  const assessmentList = await getEvaluacionesAssessments(query);
  const assessments = assessmentList.data;

  if (assessments.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No hay evaluaciones para mostrar"
        description={
          canImport
            ? 'Ajusta los filtros o importa los resultados de una evaluación para verla aquí.'
            : 'Ajusta los filtros. Si esperabas ver evaluaciones, verifica que tengas asignados los cursos correspondientes.'
        }
        action={
          canImport ? (
            <Button asChild>
              <Link href={ROUTES.importar}>
                <FileUp className="mr-2 size-4" aria-hidden />
                Importar evaluación
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return <AssessmentList assessments={assessments} />;
}
