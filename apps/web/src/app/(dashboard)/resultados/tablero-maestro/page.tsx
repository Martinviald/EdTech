import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { LayoutGrid, Table2 } from 'lucide-react';
import { canAccess, MASTER_BOARD_VIEWER_ROLES, TEACHER_PERFORMANCE_VIEWER_ROLES } from '@soe/types';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { EmptyState, FilterBarSkeleton, TableSkeleton } from '@/components/shared';
import { ComparabilityNotice } from '../components/comparability-notice';
import { MasterBoardControls } from './components/master-board-controls';
import { MasterBoardLegend, MasterBoardTable } from './master-board-table';
import { getMasterBoardMatrix, getMasterBoardTakes } from './data';
import {
  buildMasterBoardQuery,
  hasSelectedTake,
  parseMasterBoardFilters,
  takeToFilterValues,
  type MasterBoardFilterValues,
} from './master-board-filters';

export const dynamic = 'force-dynamic';

export default async function TableroMaestroPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, MASTER_BOARD_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const filters = parseMasterBoardFilters(await searchParams);
  const canViewTeacher = canAccess(session.user.roles, TEACHER_PERFORMANCE_VIEWER_ROLES);

  return (
    <>
      <Suspense fallback={<FilterBarSkeleton />}>
        <ControlsSection filters={filters} />
      </Suspense>

      <Suspense fallback={<TableSkeleton rows={6} />}>
        <MatrixSection filters={filters} canViewTeacher={canViewTeacher} />
      </Suspense>
    </>
  );
}

async function ControlsSection({ filters }: { filters: MasterBoardFilterValues }) {
  const takes = await getMasterBoardTakes('');
  return <MasterBoardControls takes={takes.takes} value={filters} />;
}

async function MatrixSection({
  filters,
  canViewTeacher,
}: {
  filters: MasterBoardFilterValues;
  canViewTeacher: boolean;
}) {
  if (!hasSelectedTake(filters)) {
    const takes = await getMasterBoardTakes('');
    if (takes.takes.length === 0) {
      return (
        <EmptyState
          icon={Table2}
          title="Aún no hay evaluaciones con resultados"
          description="Importa o calcula resultados de una toma (DIA, ensayo SIMCE, mock Cambridge) para ver el tablero maestro."
        />
      );
    }
    const query = buildMasterBoardQuery(takeToFilterValues(takes.takes[0]!, filters.metric));
    redirect(`${ROUTES.resultadosTableroMaestro}${query}`);
  }

  const matrix = await getMasterBoardMatrix(buildMasterBoardQuery(filters));
  const hasData = matrix.grades.length > 0 && matrix.subjects.length > 0;

  if (!hasData) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="No hay datos para esta toma"
        description="No se encontraron resultados para la toma seleccionada con los filtros aplicados. Elige otra toma o ajusta los filtros."
      />
    );
  }

  return (
    <div className="space-y-4">
      {matrix.take.label ? (
        <p className="text-sm text-muted-foreground">
          Toma: <span className="font-medium text-foreground">{matrix.take.label}</span>
        </p>
      ) : null}
      <ComparabilityNotice comparability={matrix.comparability} />
      <MasterBoardLegend />
      <MasterBoardTable data={matrix} canViewTeacher={canViewTeacher} />
    </div>
  );
}
