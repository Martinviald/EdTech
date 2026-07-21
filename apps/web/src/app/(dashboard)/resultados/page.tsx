import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { BarChart3, GraduationCap, ClipboardList, TriangleAlert, Inbox, CircleCheck } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  type DashboardAlert,
  type DashboardAssessmentSummary,
  type DashboardTeacherKpisResponse,
} from '@soe/types';
import {
  PageHeader,
  EmptyState,
  StatCard,
  FilterBarSkeleton,
  KpiGridSkeleton,
  CardSkeleton,
  TableSkeleton,
} from '@/components/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DashboardFilterBar } from './components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
  type DashboardFilterValues,
} from './components/dashboard-filters';
import { DistributionBar } from './components/distribution-bar';
import { formatAchievement } from './components/performance-level';
import {
  getDashboardOverview,
  getDashboardFilters,
  getDashboardTeacherKpis,
} from './data';

export const dynamic = 'force-dynamic';

const ALERT_TONE: Record<DashboardAlert['severity'], string> = {
  high: 'border-l-destructive bg-destructive/10',
  medium: 'border-l-warning bg-warning/10',
  low: 'border-l-info bg-info/10',
};

export default async function ResultadosOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const filters = parseDashboardFilters(await searchParams);
  const query = buildDashboardQuery(filters);

  // El shell (encabezado, tabs) renderiza al instante; los datos streamean por
  // sección. `key={query}` reinicia el skeleton al cambiar los filtros.
  return (
    <>
      <PageHeader variant="secondary" title="Resumen" />

      <Suspense fallback={<FilterBarSkeleton />}>
        <FiltersSection query={query} filters={filters} />
      </Suspense>

      <Suspense
        fallback={
          <>
            <KpiGridSkeleton />
            <CardSkeleton />
            <TableSkeleton />
          </>
        }
      >
        <OverviewSections query={query} />
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
  return <DashboardFilterBar options={options} value={filters} basePath={ROUTES.resultados} />;
}

async function OverviewSections({ query }: { query: string }) {
  const overview = await getDashboardOverview(query);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="% Logro global"
          value={formatAchievement(overview.globalAchievement)}
          hint="Promedio sobre el alcance filtrado"
          icon={BarChart3}
        />
        <StatCard
          label="Alumnos evaluados"
          value={overview.studentsEvaluated.toLocaleString('es-CL')}
          icon={GraduationCap}
        />
        <StatCard
          label="Evaluaciones"
          value={overview.assessmentsCount.toLocaleString('es-CL')}
          icon={ClipboardList}
        />
        <StatCard
          label="Alertas"
          value={overview.alerts.length.toLocaleString('es-CL')}
          hint="Cursos/habilidades que requieren atención"
          icon={TriangleAlert}
        />
      </div>

      <DistributionBar distribution={overview.performanceDistribution} />

      <AlertsSection alerts={overview.alerts} />

      <RecentAssessments assessments={overview.recentAssessments} />

      {overview.scope === 'teacher' ? (
        <Suspense fallback={<TableSkeleton />}>
          <TeacherKpisSection query={query} />
        </Suspense>
      ) : null}
    </>
  );
}

async function TeacherKpisSection({ query }: { query: string }) {
  const kpis = await getDashboardTeacherKpis(query);
  return <TeacherKpisTable kpis={kpis} />;
}

function AlertsSection({ alerts }: { alerts: DashboardAlert[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Alertas</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <EmptyState
            tone="success"
            icon={CircleCheck}
            title="Sin alertas"
            description="Todos los cursos y habilidades del alcance están sobre los umbrales."
          />
        ) : (
          <ul className="space-y-2">
            {alerts.map((alert, idx) => (
              <li
                key={`${alert.type}-${alert.contextId ?? idx}`}
                className={`rounded-md border-l-4 px-4 py-3 ${ALERT_TONE[alert.severity]}`}
              >
                <p className="text-sm font-medium text-foreground">{alert.message}</p>
                {alert.contextLabel ? (
                  <p className="text-xs text-muted-foreground">{alert.contextLabel}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentAssessments({ assessments }: { assessments: DashboardAssessmentSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evaluaciones recientes</CardTitle>
      </CardHeader>
      <CardContent>
        {assessments.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Aún no hay evaluaciones"
            description="Cuando importes resultados de evaluaciones aparecerán aquí las más recientes."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Evaluación</TableHead>
                  <TableHead className="hidden md:table-cell">Asignatura</TableHead>
                  <TableHead className="hidden md:table-cell">Nivel</TableHead>
                  <TableHead className="hidden sm:table-cell">Fecha</TableHead>
                  <TableHead className="text-right">Alumnos</TableHead>
                  <TableHead className="text-right">% Logro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assessments.map((a) => (
                  <TableRow key={a.assessmentId}>
                    <TableCell className="font-medium">
                      {a.name ?? a.instrumentName}
                      <span className="block text-xs text-muted-foreground md:hidden">
                        {[a.subjectName, a.gradeName].filter(Boolean).join(' · ')}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{a.subjectName ?? '—'}</TableCell>
                    <TableCell className="hidden md:table-cell">{a.gradeName ?? '—'}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {formatDate(a.administeredAt)}
                    </TableCell>
                    <TableCell className="text-right">{a.studentsCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatAchievement(a.averageAchievement)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeacherKpisTable({ kpis }: { kpis: DashboardTeacherKpisResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mis cursos</CardTitle>
      </CardHeader>
      <CardContent>
        {kpis.courses.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No tienes cursos con resultados"
            description="Cuando se importen resultados de tus cursos asignados verás aquí sus indicadores."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Curso</TableHead>
                  <TableHead className="hidden md:table-cell">Asignatura</TableHead>
                  <TableHead className="text-right">Alumnos</TableHead>
                  <TableHead className="text-right">% Logro</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">% Aprob.</TableHead>
                  <TableHead className="text-right">Críticos</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Eval.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpis.courses.map((c) => (
                  <TableRow key={`${c.classGroupId}-${c.subjectName ?? 'all'}`}>
                    <TableCell className="font-medium">
                      {c.classGroupName}
                      {c.gradeName ? (
                        <span className="block text-xs text-muted-foreground">{c.gradeName}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{c.subjectName ?? '—'}</TableCell>
                    <TableCell className="text-right">{c.studentsCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatAchievement(c.averageAchievement)}
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell">
                      {formatAchievement(c.passingRate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={c.criticalStudents > 0 ? 'font-medium text-destructive' : ''}>
                        {c.criticalStudents}
                      </span>
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell">
                      {c.assessmentsCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}
