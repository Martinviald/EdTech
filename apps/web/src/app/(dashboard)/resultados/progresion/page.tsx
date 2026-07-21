import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { TrendingUp } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import {
  ANALYTICS_VIEWER_ROLES,
  canAccess,
  PROGRESSION_SCOPES,
  type PerformanceLevel,
  type ProgressionResponse,
  type ProgressionScope,
} from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  PageHeader,
  EmptyState,
  FilterBarSkeleton,
  CardSkeleton,
} from '@/components/shared';
import {
  parseDashboardFilters,
  type DashboardFilterValues,
} from '../components/dashboard-filters';
import { ProgressionChart } from '../components/charts/progression-chart';
import { ExportViewButton } from '../components/charts/export-view-button';
import { PERFORMANCE_LEVEL_LABELS } from '../components/charts/performance-distribution';
import { ProgressionScopeBar } from './progression-scope-bar';
import { getDashboardFilters } from '../data';
import { getProgression } from './data';

type SearchParams = Record<string, string | string[] | undefined>;

const BASE_PATH = ROUTES.resultadosProgresion;

const SCOPE_LABELS: Record<ProgressionScope, string> = {
  student: 'Alumno',
  class: 'Curso',
  skill: 'Habilidad',
};

function fmtPct(value: number | null): string {
  return value === null ? '—' : `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

function fmtDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pick(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  const value = Array.isArray(v) ? v[0] : v;
  return value && value.length > 0 ? value : undefined;
}

function isScope(value: string | undefined): value is ProgressionScope {
  return !!value && (PROGRESSION_SCOPES as readonly string[]).includes(value);
}

function progFilterSummary(data: ProgressionResponse): string {
  return `${SCOPE_LABELS[data.scope]}: ${data.entityLabel ?? '—'}`;
}

function progExportTables(data: ProgressionResponse) {
  return [
    {
      name: 'Progresión',
      table: {
        columns: ['Evaluación', 'Instrumento', 'Fecha', '% logro', 'Nivel'],
        rows: data.points.map((p) => [
          p.assessmentName ?? '—',
          p.instrumentName,
          fmtDate(p.administeredAt),
          fmtPct(p.achievement),
          p.performanceLevel
            ? PERFORMANCE_LEVEL_LABELS[p.performanceLevel as PerformanceLevel]
            : '—',
        ]),
      },
    },
  ];
}

export default async function ProgresionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ANALYTICS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const filters = parseDashboardFilters(params);

  const rawScope = pick(params, 'scope');
  const scope: ProgressionScope = isScope(rawScope) ? rawScope : 'class';
  const studentId = pick(params, 'studentId');
  const classGroupId = pick(params, 'classGroupId') ?? filters.classGroupId;
  const nodeId = pick(params, 'nodeId');

  // El scope determina la entidad medida (contrato analytics.schema).
  const entityId =
    scope === 'student' ? studentId : scope === 'class' ? classGroupId : nodeId;

  const progressionQuery = buildProgressionQuery({
    scope,
    studentId,
    classGroupId,
    nodeId,
    filters,
    entityId,
  });

  return (
    <>
      <PageHeader variant="secondary"
        title="Progresión a lo largo del período"
        description="Sigue la evolución del % de logro a través de las evaluaciones de un alumno, curso o habilidad."
        actions={
          <Suspense fallback={null}>
            <ProgresionAction query={progressionQuery} />
          </Suspense>
        }
      />

      <Suspense
        key={`scope-${scope}-${classGroupId ?? ''}`}
        fallback={<FilterBarSkeleton fields={2} />}
      >
        <ScopeSection
          scope={scope}
          studentId={studentId}
          classGroupId={classGroupId}
          nodeId={nodeId}
        />
      </Suspense>

      <Suspense fallback={<CardSkeleton rows={6} />}>
        <ProgresionSection query={progressionQuery} scope={scope} entityId={entityId} />
      </Suspense>
    </>
  );
}

function buildProgressionQuery({
  scope,
  studentId,
  classGroupId,
  nodeId,
  filters,
  entityId,
}: {
  scope: ProgressionScope;
  studentId?: string;
  classGroupId?: string;
  nodeId?: string;
  filters: DashboardFilterValues;
  entityId?: string;
}): string | null {
  if (!entityId) return null;
  const qs = new URLSearchParams({ scope });
  if (scope === 'student' && studentId) qs.set('studentId', studentId);
  if (scope === 'class' && classGroupId) qs.set('classGroupId', classGroupId);
  if (scope === 'skill' && nodeId) qs.set('nodeId', nodeId);
  if (filters.subjectId) qs.set('subjectId', filters.subjectId);
  if (filters.academicYearId) qs.set('academicYearId', filters.academicYearId);
  return `?${qs.toString()}`;
}

async function ScopeSection({
  scope,
  studentId,
  classGroupId,
  nodeId,
}: {
  scope: ProgressionScope;
  studentId?: string;
  classGroupId?: string;
  nodeId?: string;
}) {
  const options = await getDashboardFilters('');
  return (
    <ProgressionScopeBar
      options={options}
      basePath={BASE_PATH}
      scope={scope}
      studentId={studentId}
      classGroupId={classGroupId}
      nodeId={nodeId}
    />
  );
}

async function ProgresionAction({ query }: { query: string | null }) {
  if (!query) return null;
  const data = await getProgression(query);
  if (data.points.length === 0) return null;
  return (
    <ExportViewButton
      title="Progresión a lo largo del período"
      subtitle={progFilterSummary(data)}
      fileName="progresion"
      tables={progExportTables(data)}
    />
  );
}

async function ProgresionSection({
  query,
  scope,
  entityId,
}: {
  query: string | null;
  scope: ProgressionScope;
  entityId?: string;
}) {
  if (!entityId || !query) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Selecciona una entidad"
        description={
          scope === 'student'
            ? 'Indica el alumno (studentId) que quieres seguir en el tiempo.'
            : scope === 'class'
              ? 'Elige el curso a seguir en la barra de alcance.'
              : 'Indica la habilidad (nodeId) que quieres seguir en el tiempo.'
        }
      />
    );
  }

  const data = await getProgression(query);
  const points = data.points;

  if (points.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="Sin progresión disponible"
        description="No hay evaluaciones con resultados para esta entidad en el período seleccionado."
      />
    );
  }

  const filterSummary = progFilterSummary(data);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Evolución del % de logro
            {filterSummary ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {filterSummary}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ProgressionChart points={points} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle por evaluación</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Evaluación</th>
                <th className="py-2 pr-4 font-medium">Instrumento</th>
                <th className="py-2 pr-4 font-medium">Fecha</th>
                <th className="py-2 pr-4 font-medium">% logro</th>
                <th className="py-2 pr-4 font-medium">Nivel</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.assessmentId} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{p.assessmentName ?? '—'}</td>
                  <td className="py-2 pr-4">{p.instrumentName}</td>
                  <td className="py-2 pr-4">{fmtDate(p.administeredAt)}</td>
                  <td className="py-2 pr-4">{fmtPct(p.achievement)}</td>
                  <td className="py-2 pr-4">
                    {p.performanceLevel
                      ? PERFORMANCE_LEVEL_LABELS[p.performanceLevel as PerformanceLevel]
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
