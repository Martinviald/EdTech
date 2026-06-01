import { redirect } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  HEATMAP_VIEWER_ROLES,
  userHasAnyRole,
  TEACHER_ROLES,
  type HeatmapResponse,
  type HeatmapRow,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { DashboardFilterBar } from '../components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
} from '../components/dashboard-filters';
import { ResultadosNav } from '../components/resultados-nav';
import { formatAchievement } from '../components/performance-level';
import { ExportButton, type ExportColumn } from '../components/export/export-button';
import { HeatmapTable, HeatmapLegend } from './heatmap-table';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/resultados/mapa-calor';

export default async function MapaCalorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, HEATMAP_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const query = buildDashboardQuery(filters);

  const [heatmap, options] = await Promise.all([
    apiGet<HeatmapResponse>(`/heatmap${query}`),
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${query}`),
  ]);

  const isTeacher = userHasAnyRole(session.user.roles, TEACHER_ROLES);
  const hasData = heatmap.rows.length > 0 && heatmap.subjects.length > 0;

  // ── Datos de exportación (filas planas) ────────────────────────────────────
  // Aplana la matriz: una fila por habilidad, una columna por asignatura + Total.
  const exportColumns: ExportColumn<Record<string, string>>[] = [
    { key: 'habilidad', header: 'Habilidad' },
    ...heatmap.subjects.map((s) => ({ key: s.subjectId, header: s.subjectName })),
    { key: 'total', header: 'Total' },
  ];
  const exportRows: Record<string, string>[] = heatmap.rows.map((row) =>
    flattenRow(row),
  );
  const filtersSummary = buildFiltersSummary(filters, options);

  return (
    <PageContainer>
      <PageHeader
        title="Mapa de calor"
        description="% de logro promedio por habilidad (filas) y asignatura (columnas). Las habilidades más críticas aparecen primero (H6.10)."
      />

      <ResultadosNav />

      <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />

      {!hasData ? (
        <EmptyState
          icon={LayoutGrid}
          title={
            isTeacher
              ? 'No hay datos para tus cursos'
              : 'No hay datos para el mapa de calor'
          }
          description={
            isTeacher
              ? 'No se encontraron resultados de habilidades en los cursos que tienes asignados con los filtros aplicados.'
              : 'No se encontraron resultados de habilidades para los filtros aplicados. Ajusta los filtros o importa más resultados.'
          }
        />
      ) : (
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
      )}
    </PageContainer>
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
