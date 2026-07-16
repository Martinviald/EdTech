import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  PERFORMANCE_LEVELS,
  type PerformanceLevel,
  type DashboardPerformanceResponse,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DashboardFilterBar } from '../components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
} from '../components/dashboard-filters';
import { ResultadosNav } from '../components/resultados-nav';
import { DistributionBar } from '../components/distribution-bar';
import { PerformanceBadge } from '../components/performance-badge';
import { PaginationControls } from '@/components/patterns';
import { PerformanceLevelFilter } from '../components/performance-level-filter';
import { formatAchievement } from '../components/performance-level';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/resultados/clasificacion';

function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = value ? Number.parseInt(value, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parsePerformanceLevel(
  raw: string | string[] | undefined,
): PerformanceLevel | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PERFORMANCE_LEVELS.includes(value as PerformanceLevel)
    ? (value as PerformanceLevel)
    : undefined;
}

export default async function ClasificacionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const page = parsePage(params.page);
  const limit = 50;
  const performanceLevel = parsePerformanceLevel(params.performanceLevel);

  const filterQuery = buildDashboardQuery(filters);
  const perfParams = new URLSearchParams(filterQuery ? filterQuery.slice(1) : '');
  perfParams.set('page', String(page));
  perfParams.set('limit', String(limit));
  if (performanceLevel) perfParams.set('performanceLevel', performanceLevel);

  const [performance, options] = await Promise.all([
    apiGet<DashboardPerformanceResponse>(`/dashboards/performance?${perfParams.toString()}`),
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${filterQuery}`),
  ]);

  const students = performance.students;

  return (
    <PageContainer>
      <PageHeader
        title="Clasificación por nivel"
        description="Distribución de niveles de desempeño y clasificación de cada alumno (H6.4)."
      />

      <ResultadosNav />

      <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />

      <DistributionBar
        distribution={performance.distribution}
        bands={performance.bands}
        bandDistribution={performance.bandDistribution}
      />

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-base font-semibold">Clasificación de alumnos</h2>
            <PerformanceLevelFilter value={performanceLevel} basePath={BASE_PATH} />
          </div>

          {students.total === 0 ? (
            <EmptyState
              icon={Users}
              title="No hay alumnos clasificados"
              description="No se encontraron alumnos con resultados para los filtros aplicados."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alumno</TableHead>
                      <TableHead className="hidden sm:table-cell">RUT</TableHead>
                      <TableHead className="hidden md:table-cell">Curso</TableHead>
                      <TableHead className="text-right">% Logro</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Nota</TableHead>
                      <TableHead>Nivel</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.data.map((s) => (
                      <TableRow key={s.studentId}>
                        <TableCell className="font-medium">
                          {s.studentFullName}
                          <span className="block text-xs text-muted-foreground sm:hidden">
                            {s.studentRut}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{s.studentRut}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          {s.classGroupName ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatAchievement(s.achievement)}
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell">
                          {s.grade ?? '—'}
                        </TableCell>
                        <TableCell>
                          <PerformanceBadge level={s.performanceLevel} band={s.performanceBand} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <PaginationControls
                page={students.page}
                limit={students.limit}
                total={students.total}
                basePath={BASE_PATH}
              />
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
