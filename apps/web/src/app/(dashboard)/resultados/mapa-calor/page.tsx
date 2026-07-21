import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  HEATMAP_VIEWER_ROLES,
  userHasAnyRole,
  TEACHER_ROLES,
  type HeatmapRow,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import {
  PageHeader,
  EmptyState,
  FilterBarSkeleton,
  TableSkeleton,
} from '@/components/shared';
import { AskAiButton, RegisterAssistantContext } from '@/components/assistant';
import { DashboardFilterBar } from '../components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
  type DashboardFilterValues,
} from '../components/dashboard-filters';
import { dashboardFiltersToAssistantRefs } from '../components/assistant-context';
import { formatAchievement } from '../components/performance-level';
import { ExportButton, type ExportColumn } from '../components/export/export-button';
import { HeatmapTable, HeatmapLegend } from './heatmap-table';
import { getDashboardFilters } from '../data';
import { getHeatmap } from './data';

export const dynamic = 'force-dynamic';

const BASE_PATH = ROUTES.resultadosMapaCalor;

const ASK_AI_PROMPT =
  'Según este mapa de calor, ¿cuáles son las habilidades más críticas y en qué asignaturas/cursos debería enfocar primero?';

export default async function MapaCalorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, HEATMAP_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const query = buildDashboardQuery(filters);
  const isTeacher = userHasAnyRole(session.user.roles, TEACHER_ROLES);

  return (
    <>
      <RegisterAssistantContext refs={dashboardFiltersToAssistantRefs(filters)} />
      <PageHeader variant="secondary"
        title="Mapa de calor"
        description="% de logro promedio por habilidad (filas) y asignatura (columnas). Las habilidades más críticas aparecen primero (H6.10)."
        actions={
          <Suspense fallback={null}>
            <MapaCalorAction query={query} />
          </Suspense>
        }
      />

      <Suspense fallback={<FilterBarSkeleton />}>
        <FiltersSection query={query} filters={filters} />
      </Suspense>

      <Suspense fallback={<TableSkeleton rows={6} />}>
        <HeatmapSection query={query} filters={filters} isTeacher={isTeacher} />
      </Suspense>
    </>
  );
}

async function FiltersSection({
  query,
  filters,
}: {
  query: string;
  filters: DashboardFilterValues;
}) {
  const options = await getDashboardFilters(query);
  return <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />;
}

async function MapaCalorAction({ query }: { query: string }) {
  const heatmap = await getHeatmap(query);
  const hasData = heatmap.rows.length > 0 && heatmap.subjects.length > 0;
  if (!hasData) return null;
  return <AskAiButton prompt={ASK_AI_PROMPT} />;
}

async function HeatmapSection({
  query,
  filters,
  isTeacher,
}: {
  query: string;
  filters: DashboardFilterValues;
  isTeacher: boolean;
}) {
  const [heatmap, options] = await Promise.all([getHeatmap(query), getDashboardFilters(query)]);

  const hasData = heatmap.rows.length > 0 && heatmap.subjects.length > 0;

  if (!hasData) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={isTeacher ? 'No hay datos para tus cursos' : 'No hay datos para el mapa de calor'}
        description={
          isTeacher
            ? 'No se encontraron resultados de habilidades en los cursos que tienes asignados con los filtros aplicados.'
            : 'No se encontraron resultados de habilidades para los filtros aplicados. Ajusta los filtros o importa más resultados.'
        }
      />
    );
  }

  // ── Datos de exportación (filas planas) ────────────────────────────────────
  // Aplana la matriz: una fila por habilidad, una columna por asignatura + Total.
  const exportColumns: ExportColumn<Record<string, string>>[] = [
    { key: 'habilidad', header: 'Habilidad' },
    ...heatmap.subjects.map((s) => ({ key: s.subjectId, header: s.subjectName })),
    { key: 'total', header: 'Total' },
  ];
  const exportRows: Record<string, string>[] = heatmap.rows.map((row) => flattenRow(row));
  const filtersSummary = buildFiltersSummary(filters, options);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <HeatmapLegend />
        <ExportButton
          rows={exportRows}
          columns={exportColumns}
          filename="mapa-calor"
          title="Mapa de calor — Logro por habilidad y asignatura"
          filtersSummary={filtersSummary}
        />
      </div>
      <HeatmapTable data={heatmap} />
    </div>
  );
}

/** Aplana una fila de habilidad a un objeto plano clave→% para exportar. */
function flattenRow(row: HeatmapRow): Record<string, string> {
  const record: Record<string, string> = {
    habilidad: [row.nodeCode, row.nodeName].filter(Boolean).join(' · ') || row.nodeName,
    total: formatAchievement(row.overallAchievement),
  };
  for (const cell of row.cells) {
    record[cell.subjectId] = formatAchievement(cell.averageAchievement);
  }
  return record;
}

/** Construye un resumen legible de los filtros aplicados para el export. */
function buildFiltersSummary(
  filters: ReturnType<typeof parseDashboardFilters>,
  options: DashboardFilterOptionsResponse,
): string {
  const parts: string[] = [];
  const find = (
    list: { id: string; label: string }[],
    id: string | undefined,
  ): string | undefined => (id ? list.find((o) => o.id === id)?.label : undefined);

  const period = filters.academicYearId
    ? options.periods.find((p) => p.id === filters.academicYearId)?.label
    : undefined;
  const subject = find(options.subjects, filters.subjectId);
  const grade = find(options.grades, filters.gradeId);
  const classGroup = filters.classGroupId
    ? options.classGroups.find((c) => c.id === filters.classGroupId)?.label
    : undefined;

  if (period) parts.push(period);
  if (subject) parts.push(subject);
  if (grade) parts.push(grade);
  if (classGroup) parts.push(classGroup);
  if (filters.instrumentType) parts.push(filters.instrumentType.toUpperCase());

  return parts.length > 0 ? `Filtros: ${parts.join(' · ')}` : 'Sin filtros aplicados';
}
