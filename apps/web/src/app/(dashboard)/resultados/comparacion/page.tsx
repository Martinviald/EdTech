import { redirect } from 'next/navigation';
import { BarChart3, LineChart as LineChartIcon } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  ANALYTICS_VIEWER_ROLES,
  canAccess,
  type DashboardFilterOptionsResponse,
  type GenerationalComparisonResponse,
} from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import {
  DashboardFilterBar,
  parseDashboardFilters,
} from '../components/dashboard-filter-bar';
import { GenerationalChart } from '../components/charts/generational-chart';
import { GenerationalDistributionChart } from '../components/charts/generational-distribution-chart';
import { ExportViewButton } from '../components/charts/export-view-button';
import { ResultadosNav } from '../components/resultados-nav';
import {
  PERFORMANCE_LEVEL_LABELS,
  PERFORMANCE_LEVEL_ORDER,
} from '../components/charts/performance-distribution';

type SearchParams = Record<string, string | string[] | undefined>;

const BASE_PATH = '/resultados/comparacion';

function fmtPct(value: number | null): string {
  return value === null ? '—' : `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

export default async function ComparacionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ANALYTICS_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const filters = parseDashboardFilters(params);

  const options = await apiGet<DashboardFilterOptionsResponse>('/dashboards/filters');

  // La comparación generacional requiere un nivel (grade) seleccionado.
  let data: GenerationalComparisonResponse | null = null;
  if (filters.gradeId) {
    const qs = new URLSearchParams({ gradeId: filters.gradeId });
    if (filters.subjectId) qs.set('subjectId', filters.subjectId);
    if (filters.instrumentType) qs.set('instrumentType', filters.instrumentType);
    data = await apiGet<GenerationalComparisonResponse>(
      `/analytics/generational?${qs.toString()}`,
    );
  }

  const series = data?.series ?? [];
  const hasComparison = series.length >= 2;

  const filterSummary = data
    ? [data.subjectName, data.gradeName, filters.instrumentType?.toUpperCase()]
        .filter(Boolean)
        .join(' · ')
    : '';

  // Tabla para export (H6.9): resumen por año.
  const exportTables = data
    ? [
        {
          name: 'Comparación por año',
          table: {
            columns: ['Año', 'Alumnos', '% logro promedio', '% aprobación'],
            rows: series.map((p) => [
              p.year,
              p.studentsCount,
              fmtPct(p.averageAchievement),
              fmtPct(p.passingRate),
            ]),
          },
        },
        {
          name: 'Distribución por nivel',
          table: {
            columns: ['Año', ...PERFORMANCE_LEVEL_ORDER.map((l) => PERFORMANCE_LEVEL_LABELS[l])],
            rows: series.map((p) => {
              const byLevel = new Map(p.performanceDistribution.map((b) => [b.level, b.percentage]));
              return [
                p.year,
                ...PERFORMANCE_LEVEL_ORDER.map((l) => fmtPct(byLevel.get(l) ?? 0)),
              ];
            }),
          },
        },
      ]
    : [];

  return (
    <PageContainer>
      <PageHeader
        title="Comparación de generaciones"
        description="Compara el desempeño de un mismo nivel entre años académicos distintos para detectar tendencias."
        actions={
          data && hasComparison ? (
            <ExportViewButton
              title="Comparación de generaciones"
              subtitle={filterSummary}
              fileName="comparacion-generaciones"
              tables={exportTables}
            />
          ) : undefined
        }
      />

      <ResultadosNav />

      <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />

      {!filters.gradeId ? (
        <EmptyState
          icon={BarChart3}
          title="Selecciona un nivel"
          description="Elige un nivel (y opcionalmente una asignatura e instrumento) en los filtros para comparar generaciones."
        />
      ) : !hasComparison ? (
        <EmptyState
          icon={LineChartIcon}
          title="Sin comparación disponible"
          description={
            series.length === 1
              ? 'Sólo hay datos de un período para este nivel. La comparación generacional necesita al menos dos años con resultados.'
              : 'Aún no hay resultados para este nivel con los filtros aplicados.'
          }
        />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                % logro promedio por año
                {filterSummary ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {filterSummary}
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <GenerationalChart series={series} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Distribución de desempeño por año</CardTitle>
            </CardHeader>
            <CardContent>
              <GenerationalDistributionChart series={series} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumen por generación</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Año</th>
                    <th className="py-2 pr-4 font-medium">Alumnos</th>
                    <th className="py-2 pr-4 font-medium">% logro promedio</th>
                    <th className="py-2 pr-4 font-medium">% aprobación</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((p) => (
                    <tr key={p.academicYearId} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{p.year}</td>
                      <td className="py-2 pr-4">{p.studentsCount}</td>
                      <td className="py-2 pr-4">{fmtPct(p.averageAchievement)}</td>
                      <td className="py-2 pr-4">{fmtPct(p.passingRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
