import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, FileUp } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  ANSWER_SHEET_IMPORT_ROLES,
  type AssessmentListResponse,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { DashboardFilterBar } from '../resultados/components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
} from '../resultados/components/dashboard-filters';
import { AssessmentList } from './components/assessment-list';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/evaluaciones';

export default async function EvaluacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const filterQuery = buildDashboardQuery(filters);

  // Opciones de filtro + evaluaciones disponibles (ambas acotadas por filtros y
  // por el scope del usuario). Mismo endpoint que antes alimentaba el dropdown.
  const [options, assessmentList] = await Promise.all([
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${filterQuery}`),
    apiGet<AssessmentListResponse>(`/item-analysis/assessments${filterQuery}`),
  ]);

  const assessments = assessmentList.data;
  const canImport = canAccess(session.user.roles, ANSWER_SHEET_IMPORT_ROLES);

  return (
    <PageContainer>
      <PageHeader
        title="Evaluaciones"
        description="Todas las evaluaciones a tu alcance. Elige una para entrar a su hub: resumen, resultados, análisis IA, material remedial y calidad del instrumento, sin re-seleccionar la evaluación en cada vista."
      />

      <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />

      {assessments.length === 0 ? (
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
                <Link href="/importar">
                  <FileUp className="mr-2 size-4" aria-hidden />
                  Importar evaluación
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <AssessmentList assessments={assessments} />
      )}
    </PageContainer>
  );
}
