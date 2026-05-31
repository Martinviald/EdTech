import { redirect } from 'next/navigation';
import { TrendingUp } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  ANALYTICS_VIEWER_ROLES,
  canAccess,
  PROGRESSION_SCOPES,
  type DashboardFilterOptionsResponse,
  type PerformanceLevel,
  type ProgressionResponse,
  type ProgressionScope,
} from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { parseDashboardFilters } from '../components/dashboard-filter-bar';
import { ProgressionChart } from '../components/charts/progression-chart';
import { ExportViewButton } from '../components/charts/export-view-button';
import { PERFORMANCE_LEVEL_LABELS } from '../components/charts/performance-distribution';
import { ProgressionScopeBar } from './progression-scope-bar';
import { ResultadosNav } from '../components/resultados-nav';

type SearchParams = Record<string, string | string[] | undefined>;

const BASE_PATH = '/resultados/progresion';

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

export default async function ProgresionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ANALYTICS_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const filters = parseDashboardFilters(params);

  const rawScope = pick(params, 'scope');
  const scope: ProgressionScope = isScope(rawScope) ? rawScope : 'class';
  const studentId = pick(params, 'studentId');
  const classGroupId = pick(params, 'classGroupId') ?? filters.classGroupId;
  const nodeId = pick(params, 'nodeId');

  const options = await apiGet<DashboardFilterOptionsResponse>('/dashboards/filters');

  // El scope determina la entidad medida (contrato analytics.schema).
  const entityId =
    scope === 'student' ? studentId : scope === 'class' ? classGroupId : nodeId;

  let data: ProgressionResponse | null = null;
  if (entityId) {
    const qs = new URLSearchParams({ scope });
    if (scope === 'student' && studentId) qs.set('studentId', studentId);
    if (scope === 'class' && classGroupId) qs.set('classGroupId', classGroupId);
    if (scope === 'skill' && nodeId) qs.set('nodeId', nodeId);
    if (filters.subjectId) qs.set('subjectId', filters.subjectId);
    if (filters.academicYearId) qs.set('academicYearId', filters.academicYearId);
    data = await apiGet<ProgressionResponse>(`/analytics/progression?${qs.toString()}`);
  }

  const points = data?.points ?? [];
  const hasData = points.length > 0;

  const filterSummary = data
    ? [`${SCOPE_LABELS[data.scope]}: ${data.entityLabel ?? '—'}`].filter(Boolean).join(' · ')
    : '';

  const exportTables = data
    ? [
        {
          name: 'Progresión',
          table: {
            columns: ['Evaluación', 'Instrumento', 'Fecha', '% logro', 'Nivel'],
            rows: points.map((p) => [
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
      ]
    : [];

  return (
    <PageContainer>
      <PageHeader
        title="Progresión a lo largo del período"
        description="Sigue la evolución del % de logro a través de las evaluaciones de un alumno, curso o habilidad."
        actions={
          data && hasData ? (
            <ExportViewButton
              title="Progresión a lo largo del período"
              subtitle={filterSummary}
              fileName="progresion"
              tables={exportTables}
            />
          ) : undefined
        }
      />

      <ResultadosNav />

      <ProgressionScopeBar
        options={options}
        basePath={BASE_PATH}
        scope={scope}
        studentId={studentId}
        classGroupId={classGroupId}
        nodeId={nodeId}
      />

      {!entityId ? (
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
      ) : !hasData ? (
        <EmptyState
          icon={TrendingUp}
          title="Sin progresión disponible"
          description="No hay evaluaciones con resultados para esta entidad en el período seleccionado."
        />
      ) : (
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
      )}
    </PageContainer>
  );
}
