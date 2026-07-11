import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  type DashboardSkillsResponse,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { AskAiButton, RegisterAssistantContext } from '@/components/assistant';
import { DashboardFilterBar } from '../components/dashboard-filter-bar';
import { parseDashboardFilters, buildDashboardQuery } from '../components/dashboard-filters';
import { dashboardFiltersToAssistantRefs } from '../components/assistant-context';
import { ResultadosNav } from '../components/resultados-nav';
import { SkillsBreakdown } from '../components/skills-breakdown';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/resultados/habilidades';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

export default async function HabilidadesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const query = buildDashboardQuery(filters);

  // TKT-10 — `assessmentId` no es una clave de filtro del dashboard, pero
  // `/dashboards/skills` lo acepta. Si viene en la URL (llegada desde una
  // evaluación), acota el desglose a esa evaluación y habilita el drill-down a
  // sus preguntas. Sin él, la vista es agregada (varias evaluaciones) y el
  // drill-down lo indica.
  const assessmentId = pickParam(params.assessmentId);
  const skillsQuery = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  if (assessmentId) skillsQuery.set('assessmentId', assessmentId);
  const skillsQs = skillsQuery.toString();

  const [skillsResponse, options] = await Promise.all([
    apiGet<DashboardSkillsResponse>(`/dashboards/skills${skillsQs ? `?${skillsQs}` : ''}`),
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${query}`),
  ]);

  const skills = skillsResponse.skills;

  return (
    <PageContainer>
      <RegisterAssistantContext refs={dashboardFiltersToAssistantRefs(filters)} />
      <PageHeader
        title="Logro por dimensión"
        description="% de logro promedio por dimensión de la tabla de especificaciones (habilidad, contenido, OA…). Toca un logro para ver las preguntas asociadas (H6.5)."
        actions={
          skills.length > 0 ? (
            <AskAiButton prompt="¿Qué habilidades están más descendidas y qué acciones remediales priorizarías?" />
          ) : undefined
        }
      />

      <ResultadosNav />

      <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />

      {skills.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No hay habilidades con resultados"
          description="No se encontraron habilidades evaluadas para los filtros aplicados."
        />
      ) : (
        <SkillsBreakdown
          skills={skills}
          assessmentId={assessmentId}
          classGroupId={filters.classGroupId}
        />
      )}
    </PageContainer>
  );
}
