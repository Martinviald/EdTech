import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { canAccess, DASHBOARD_VIEWER_ROLES } from '@soe/types';
import {
  PageHeader,
  EmptyState,
  FilterBarSkeleton,
  CardSkeleton,
} from '@/components/shared';
import { AskAiButton, RegisterAssistantContext } from '@/components/assistant';
import { DashboardFilterBar } from '../components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
  type DashboardFilterValues,
} from '../components/dashboard-filters';
import { dashboardFiltersToAssistantRefs } from '../components/assistant-context';
import { SkillsBreakdown } from '../components/skills-breakdown';
import { getDashboardFilters } from '../data';
import { getDashboardSkills } from './data';

export const dynamic = 'force-dynamic';

const BASE_PATH = ROUTES.resultadosHabilidades;

const ASK_AI_PROMPT =
  '¿Qué habilidades están más descendidas y qué acciones remediales priorizarías?';

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
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const query = buildDashboardQuery(filters);

  // TKT-10 — `assessmentId` no es una clave de filtro del dashboard, pero
  // `/dashboards/skills` lo acepta. Si viene en la URL (llegada desde una
  // evaluación), acota el desglose a esa evaluación y habilita el drill-down a
  // sus preguntas. Sin él, la vista es agregada (varias evaluaciones) y el
  // drill-down lo indica.
  const assessmentId = pickParam(params.assessmentId);
  const skillsParams = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  if (assessmentId) skillsParams.set('assessmentId', assessmentId);
  const skillsQs = skillsParams.toString();
  const skillsQuery = skillsQs ? `?${skillsQs}` : '';

  return (
    <>
      <RegisterAssistantContext refs={dashboardFiltersToAssistantRefs(filters)} />
      <PageHeader variant="secondary"
        title="Logro por dimensión"
        description="% de logro promedio por dimensión de la tabla de especificaciones (habilidad, contenido, OA…). Toca un logro para ver las preguntas asociadas (H6.5)."
        actions={
          <Suspense fallback={null}>
            <HabilidadesAction query={skillsQuery} />
          </Suspense>
        }
      />

      <Suspense fallback={<FilterBarSkeleton />}>
        <FiltersSection query={query} filters={filters} />
      </Suspense>

      <Suspense fallback={<CardSkeleton rows={5} />}>
        <SkillsSection query={skillsQuery} filters={filters} assessmentId={assessmentId} />
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
  return <DashboardFilterBar options={options} value={filters} basePath={BASE_PATH} />;
}

async function HabilidadesAction({ query }: { query: string }) {
  const skillsResponse = await getDashboardSkills(query);
  if (skillsResponse.skills.length === 0) return null;
  return <AskAiButton prompt={ASK_AI_PROMPT} />;
}

async function SkillsSection({
  query,
  filters,
  assessmentId,
}: {
  query: string;
  filters: DashboardFilterValues;
  assessmentId?: string;
}) {
  const skillsResponse = await getDashboardSkills(query);
  const skills = skillsResponse.skills;

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No hay habilidades con resultados"
        description="No se encontraron habilidades evaluadas para los filtros aplicados."
      />
    );
  }

  return <SkillsBreakdown skills={skills} filters={filters} assessmentId={assessmentId} />;
}
