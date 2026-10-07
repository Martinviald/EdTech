import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { GraduationCap, ClipboardList, TriangleAlert } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  type ComparableUnitSummary,
  type DashboardTeacherKpisResponse,
} from '@soe/types';
import { canSeeBenchmark, getInstrumentSamples } from '@/lib/benchmark-samples';
import {
  EmptyState,
  StatCard,
  CompactFilterBarSkeleton,
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
import { GenerationalBanner } from './components/generational-banner';
import { DashboardFilterBar } from './components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
  buildDashboardHref,
  buildClearProcessQuery,
  hasNarrowingFilters,
  withEntryDefaults,
  type DashboardFilterValues,
} from './components/dashboard-filters';
import { ComparabilityNotice } from './components/comparability-notice';
import { ProcessPreviewBanner } from './components/process-preview-banner';
import { ProcessResultsSection } from './components/process-results-section';
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
      <Suspense fallback={<CompactFilterBarSkeleton />}>
        <FiltersSection query={query} filters={filters} />
      </Suspense>

      <Suspense fallback={null}>
        <ProcessPreviewSection query={query} filters={filters} />
      </Suspense>

      {/* La síntesis por conteo y la matriz del proceso activo. Streamean aparte:
          piden `/coverage`, y el panorama no tiene que esperarlas. El fallback es
          nulo porque la sección no pinta nada sin proceso activo, y un skeleton
          fantasma deja un salto de layout. */}
      <Suspense fallback={null}>
        <ProcessResultsBlock query={query} filters={filters} />
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
        <PanoramaSections
          query={query}
          filters={filters}
          canSeeSample={canSeeBenchmark(session.user.roles)}
        />
      </Suspense>
    </>
  );
}

/**
 * La previsualización del proceso activo. Resuelve los defaults de entrada acá
 * porque `processId` puede venir de la URL o de la preselección, y la banda tiene
 * que aparecer en ambos casos.
 */
async function ProcessPreviewSection({
  query,
  filters,
}: {
  query: string;
  filters: DashboardFilterValues;
}) {
  const options = await getDashboardFilters(query);
  const scoped = withEntryDefaults(filters, options);
  if (!scoped.processId) return null;

  return (
    <ProcessPreviewBanner
      processId={scoped.processId}
      scopedQuery={buildDashboardQuery(scoped)}
      clearHref={`${ROUTES.resultados}${buildClearProcessQuery(scoped)}`}
    />
  );
}

/**
 * La síntesis y la matriz del proceso, sólo con proceso activo. Resuelve los
 * defaults de entrada igual que la banda, porque `processId` puede venir de la
 * URL o de la preselección.
 */
async function ProcessResultsBlock({
  query,
  filters,
}: {
  query: string;
  filters: DashboardFilterValues;
}) {
  const options = await getDashboardFilters(query);
  const scoped = withEntryDefaults(filters, options);
  if (!scoped.processId) return null;

  return (
    <ProcessResultsSection
      processId={scoped.processId}
      scopedQuery={buildDashboardQuery(scoped)}
      grades={options.grades}
      narrowedByFilters={hasNarrowingFilters(scoped)}
    />
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
  return (
    <DashboardFilterBar
      options={options}
      value={withEntryDefaults(filters, options)}
      basePath={ROUTES.resultados}
    />
  );
}

/**
 * El panorama, en el orden en que se lee: primero lo que requiere atención, después
 * el desglose por unidad comparable.
 *
 * No hay ningún número que resuma el alcance completo — ver #1C. Los tres de arriba
 * son CONTEOS (no promedian nada) y la matriz entrega un % por instrumento, que es el
 * nivel más grande donde un porcentaje todavía significa algo.
 */
async function PanoramaSections({
  query,
  filters,
  canSeeSample,
}: {
  query: string;
  filters: DashboardFilterValues;
  canSeeSample: boolean;
}) {
  const options = await getDashboardFilters(query);
  const scopedQuery = buildDashboardQuery(withEntryDefaults(filters, options));
  const comparable = await getComparableOverview(scopedQuery);
  const search = filters.q
    ? {
        term: filters.q,
        clearHref:
          `${ROUTES.resultados}${buildDashboardHref({ ...filters, q: undefined })}` as Route,
      }
    : undefined;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Alumnos evaluados"
          value={comparable.totals.studentsEvaluated.toLocaleString('es-CL')}
          hint={`${comparable.totals.classifications.toLocaleString('es-CL')} clasificaciones`}
          icon={GraduationCap}
        />
        <StatCard
          label="Evaluaciones"
          value={comparable.totals.assessments.toLocaleString('es-CL')}
          icon={ClipboardList}
        />
        <StatCard
          label="Requieren atención"
          value={comparable.alertsTotal.toLocaleString('es-CL')}
          hint="Cursos y habilidades bajo umbral"
          icon={TriangleAlert}
        />
      </div>

      <LiveAlertsBanner
        query={scopedQuery}
        initial={{ alerts: comparable.alerts, total: comparable.alertsTotal }}
      />

      <GenerationalBanner cells={comparable.generational} />

      <ComparabilityNotice comparability={comparable.comparability} />

      {canSeeSample && comparable.scope !== 'teacher' && comparable.units.length > 0 ? (
        <Suspense fallback={<ComparableUnitsTable units={comparable.units} search={search} />}>
          <UnitsTableWithSamples
            units={comparable.units}
            search={search}
            courseScoped={(filters.classGroupId?.length ?? 0) > 0}
          />
        </Suspense>
      ) : (
        <ComparableUnitsTable units={comparable.units} search={search} />
      )}

      {comparable.scope === 'teacher' ? (
        <Suspense fallback={<TableSkeleton />}>
          <TeacherKpisSection query={scopedQuery} />
        </Suspense>
      ) : null}
    </>
  );
}

async function UnitsTableWithSamples({
  units,
  search,
  courseScoped,
}: {
  units: ComparableUnitSummary[];
  search: { term: string; clearHref: Route } | undefined;
  courseScoped: boolean;
}) {
  const samples = await getInstrumentSamples(units.map((u) => u.instrumentId));
  return (
    <ComparableUnitsTable
      units={units}
      search={search}
      samples={samples}
      sampleSubject={courseScoped ? 'course' : 'school'}
    />
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
