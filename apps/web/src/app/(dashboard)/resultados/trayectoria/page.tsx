import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { ArrowRight, LineChart as LineChartIcon, Target, TrendingUp, Users } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import {
  ANALYTICS_VIEWER_ROLES,
  canAccess,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  INSTRUMENT_APPLICATION_PERIODS,
  type ComparableTrajectoryAxis,
  type ComparableTrajectoryResponse,
  type InstrumentApplicationPeriod,
} from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  EmptyState,
  MetricComparison,
  FilterBarSkeleton,
  CardSkeleton,
  type MetricDelta,
} from '@/components/shared';
import { ComparabilityNotice } from '../components/comparability-notice';
import { DistributionBar } from '../components/distribution-bar';
import { ResultadosNavActions } from '../components/nav-actions';
import { TrajectoryChart } from '../components/charts/trajectory-chart';
import { ExportViewButton } from '../components/charts/export-view-button';
import { formatAchievement } from '../components/performance-level';
import { getDashboardFilters } from '../data';
import { getComparableTrajectory } from './data';
import { AxisToggle } from './axis-toggle';
import { TrajectoryScopeBar, type TrajectorySelection } from './trajectory-scope-bar';

type SearchParams = Record<string, string | string[] | undefined>;

const BASE_PATH = ROUTES.resultadosTrayectoria;

const AXES: readonly ComparableTrajectoryAxis[] = ['years', 'moments'];

function fmtPp(value: number): string {
  return `${Math.abs(value).toFixed(1)} pp`;
}

function pick(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  const value = Array.isArray(v) ? v[0] : v;
  return value && value.length > 0 ? value : undefined;
}

function parseSelection(params: SearchParams): TrajectorySelection {
  const rawAxis = pick(params, 'axis');
  const axis: ComparableTrajectoryAxis = AXES.includes(rawAxis as ComparableTrajectoryAxis)
    ? (rawAxis as ComparableTrajectoryAxis)
    : 'years';
  const rawPeriod = pick(params, 'applicationPeriod');
  const applicationPeriod = INSTRUMENT_APPLICATION_PERIODS.includes(
    rawPeriod as InstrumentApplicationPeriod,
  )
    ? (rawPeriod as InstrumentApplicationPeriod)
    : undefined;
  return {
    axis,
    gradeId: pick(params, 'gradeId'),
    subjectId: pick(params, 'subjectId'),
    instrumentType: pick(params, 'instrumentType'),
    applicationPeriod,
    classGroupId: pick(params, 'classGroupId'),
  };
}

function selectionParams(sel: TrajectorySelection): URLSearchParams {
  const qs = new URLSearchParams({ axis: sel.axis });
  if (sel.gradeId) qs.set('gradeId', sel.gradeId);
  if (sel.subjectId) qs.set('subjectId', sel.subjectId);
  if (sel.instrumentType) qs.set('instrumentType', sel.instrumentType);
  if (sel.axis === 'years' && sel.applicationPeriod) {
    qs.set('applicationPeriod', sel.applicationPeriod);
  }
  return qs;
}

function buildQuery(sel: TrajectorySelection): string | null {
  if (!sel.gradeId || !sel.subjectId || !sel.instrumentType) return null;
  const qs = selectionParams(sel);
  if (sel.classGroupId) qs.set('classGroupId', sel.classGroupId);
  return `?${qs.toString()}`;
}

function courseHref(sel: TrajectorySelection, classGroupId: string | null): Route {
  const qs = selectionParams(sel);
  if (classGroupId) qs.set('classGroupId', classGroupId);
  return `${BASE_PATH}?${qs.toString()}` as Route;
}

function summaryOf(data: ComparableTrajectoryResponse): string {
  const period =
    data.applicationPeriod != null
      ? INSTRUMENT_APPLICATION_PERIOD_LABELS[data.applicationPeriod]
      : null;
  return [data.subjectName, data.gradeName, data.instrumentType.toUpperCase(), period]
    .filter(Boolean)
    .join(' · ');
}

function exportTablesOf(data: ComparableTrajectoryResponse) {
  return [
    {
      name: 'Trayectoria',
      table: {
        columns: ['Punto', 'Instrumento', 'Alumnos', '% logro'],
        rows: data.series.map((p) => [
          p.label,
          p.instrumentName,
          p.studentsAssessed,
          p.averageAchievement == null ? '—' : `${p.averageAchievement.toFixed(1)}%`,
        ]),
      },
    },
    {
      name: 'Cursos del punto actual',
      table: {
        columns: ['Curso', 'Alumnos', '% logro', '% en nivel más bajo'],
        rows: data.byClassGroup.map((c) => [
          c.classGroupName,
          c.studentsAssessed,
          c.averageAchievement == null ? '—' : `${c.averageAchievement.toFixed(1)}%`,
          c.lowestBandShare == null ? '—' : `${c.lowestBandShare.toFixed(0)}%`,
        ]),
      },
    },
  ];
}

export default async function TrayectoriaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ANALYTICS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const selection = parseSelection(params);
  const query = buildQuery(selection);

  return (
    <>
      <ResultadosNavActions>
        <AxisToggle axis={selection.axis} basePath={BASE_PATH} />
        <Suspense fallback={null}>
          <TrayectoriaAction query={query} />
        </Suspense>
      </ResultadosNavActions>

      <Suspense fallback={<FilterBarSkeleton fields={5} />}>
        <SelectorSection selection={selection} />
      </Suspense>

      <Suspense fallback={<CardSkeleton rows={6} />}>
        <TrajectorySection selection={selection} query={query} />
      </Suspense>
    </>
  );
}

async function SelectorSection({ selection }: { selection: TrajectorySelection }) {
  const options = await getDashboardFilters('');
  return <TrajectoryScopeBar options={options} basePath={BASE_PATH} selection={selection} />;
}

async function TrayectoriaAction({ query }: { query: string | null }) {
  if (!query) return null;
  const data = await getComparableTrajectory(query);
  if (data.series.length === 0) return null;
  return (
    <ExportViewButton
      title="Trayectoria comparable"
      subtitle={summaryOf(data)}
      fileName="trayectoria-comparable"
      tables={exportTablesOf(data)}
    />
  );
}

async function TrajectorySection({
  selection,
  query,
}: {
  selection: TrajectorySelection;
  query: string | null;
}) {
  if (!query) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="Elige qué comparar"
        description="Selecciona un nivel, una asignatura y una medición (instrumento) para ver su trayectoria comparable. Todos los puntos serán de la misma familia, así que sí se pueden comparar entre sí."
      />
    );
  }

  const data = await getComparableTrajectory(query);
  const { series, current } = data;

  if (series.length === 0 || !current) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sin datos para esta medición"
        description="No hay evaluaciones con resultados para la familia seleccionada. Prueba con otra asignatura, medición o nivel."
      />
    );
  }

  const comparisons: MetricDelta[] = [];
  if (data.baselines.previousPeriod) {
    comparisons.push({
      value: data.baselines.previousPeriod.deltaPp,
      label: 'vs momento anterior',
      format: fmtPp,
    });
  }
  if (data.baselines.previousYear) {
    comparisons.push({
      value: data.baselines.previousYear.deltaPp,
      label: 'vs año anterior',
      format: fmtPp,
    });
  }

  const refBaseline =
    data.axis === 'years' ? data.baselines.previousYear : data.baselines.previousPeriod;
  const summary = summaryOf(data);

  return (
    <div className="space-y-6">
      <ComparabilityNotice comparability={data.comparability} />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricComparison
          label={`% Logro · ${current.label}`}
          value={formatAchievement(current.averageAchievement)}
          icon={Target}
          comparisons={comparisons}
          hint={data.classGroupName ? `Curso ${data.classGroupName}` : 'Todo el nivel'}
        />
        <MetricComparison
          label={`Alumnos evaluados · ${current.label}`}
          value={String(current.studentsAssessed)}
          icon={Users}
        />
        <MetricComparison
          label="En el nivel más bajo"
          value={
            current.bandDistribution && current.bandDistribution.length > 0
              ? `${lowestBandShare(current.bandDistribution).toFixed(0)}%`
              : '—'
          }
          icon={TrendingUp}
          hint="Concentración en la banda inferior del instrumento"
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Trayectoria del % de logro
            {summary ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">{summary}</span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TrajectoryChart
            series={series}
            baselineAchievement={refBaseline?.achievement ?? null}
            baselineLabel={data.axis === 'years' ? 'Año anterior' : 'Momento anterior'}
          />
        </CardContent>
      </Card>

      {current.bandDistribution && data.bands ? (
        <DistributionBar
          distribution={[]}
          bands={data.bands}
          bandDistribution={current.bandDistribution}
          title={`Distribución por nivel · ${current.label}`}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Desglose por curso · {current.label}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {data.byClassGroup.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin resultados por curso para este punto.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Curso</th>
                  <th className="py-2 pr-4 font-medium">Alumnos</th>
                  <th className="py-2 pr-4 font-medium">% logro</th>
                  <th className="py-2 pr-4 font-medium">% en nivel más bajo</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.byClassGroup.map((c) => {
                  const active = c.classGroupId === selection.classGroupId;
                  return (
                    <tr key={c.classGroupId} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{c.classGroupName}</td>
                      <td className="py-2 pr-4">{c.studentsAssessed}</td>
                      <td className="py-2 pr-4">{formatAchievement(c.averageAchievement)}</td>
                      <td className="py-2 pr-4">
                        {c.lowestBandShare == null ? '—' : `${c.lowestBandShare.toFixed(0)}%`}
                      </td>
                      <td className="py-2 text-right">
                        <Link
                          href={courseHref(selection, active ? null : c.classGroupId)}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          {active ? 'Ver todo el nivel' : 'Ver curso'}
                          <ArrowRight className="size-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function lowestBandShare(distribution: { order: number; percentage: number }[]): number {
  const lowest = distribution.reduce((min, b) => (b.order < min.order ? b : min));
  return lowest.percentage;
}
