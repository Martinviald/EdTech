import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { GraduationCap, ClipboardList, TriangleAlert } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { canAccess, DASHBOARD_VIEWER_ROLES, type DashboardTeacherKpisResponse } from '@soe/types';
import {
  EmptyState,
  StatCard,
  FilterBarSkeleton,
  KpiGridSkeleton,
  CardSkeleton,
  TableSkeleton,
} from '@/components/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LiveAlertsBanner } from './components/live-alerts-banner';
import { ComparableUnitsTable } from './components/comparable-units-table';
import { DashboardFilterBar } from './components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
  type DashboardFilterValues,
} from './components/dashboard-filters';
import { ComparabilityNotice } from './components/comparability-notice';
import { formatAchievement } from './components/performance-level';
import { getComparableOverview, getDashboardFilters, getDashboardTeacherKpis } from './data';

export const dynamic = 'force-dynamic';

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
        <PanoramaSections query={query} />
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

/**
 * El panorama, en el orden en que se lee: primero lo que requiere atención, después
 * el desglose por unidad comparable.
 *
 * No hay ningún número que resuma el alcance completo — ver #1C. Los tres de arriba
 * son CONTEOS (no promedian nada) y la matriz entrega un % por instrumento, que es el
 * nivel más grande donde un porcentaje todavía significa algo.
 */
async function PanoramaSections({ query }: { query: string }) {
  const comparable = await getComparableOverview(query);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Alumnos evaluados"
          value={comparable.totals.studentsEvaluated.toLocaleString('es-CL')}
          icon={GraduationCap}
        />
        <StatCard
          label="Evaluaciones"
          value={comparable.totals.assessments.toLocaleString('es-CL')}
          icon={ClipboardList}
        />
        <StatCard
          label="Requieren atención"
          value={comparable.alerts.length.toLocaleString('es-CL')}
          hint="Cursos y habilidades bajo umbral"
          icon={TriangleAlert}
        />
      </div>

      <LiveAlertsBanner query={query} initialAlerts={comparable.alerts} />

      <ComparabilityNotice comparability={comparable.comparability} />

      <ComparableUnitsTable units={comparable.units} />

      {comparable.scope === 'teacher' ? (
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

function TeacherKpisTable({ kpis }: { kpis: DashboardTeacherKpisResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mis cursos</CardTitle>
        <CardDescription>
          Una fila por curso y evaluación: el % de logro sólo se puede leer dentro de un mismo
          instrumento.
        </CardDescription>
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
                  <TableHead className="hidden lg:table-cell">Evaluación</TableHead>
                  <TableHead className="text-right">Alumnos</TableHead>
                  <TableHead className="text-right">% Logro</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">% Aprob.</TableHead>
                  <TableHead className="text-right">Críticos</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Eval.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpis.courses.map((c) => (
                  <TableRow key={`${c.classGroupId}-${c.instrumentId ?? 'sin-instrumento'}`}>
                    <TableCell className="font-medium">
                      {c.classGroupName}
                      {c.gradeName ? (
                        <span className="block text-xs text-muted-foreground">{c.gradeName}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{c.subjectName ?? '—'}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {c.instrumentName ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">{c.studentsCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatAchievement(c.averageAchievement)}
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell">
                      {formatAchievement(c.passingRate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={c.criticalStudents > 0 ? 'font-medium text-destructive' : ''}
                      >
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
