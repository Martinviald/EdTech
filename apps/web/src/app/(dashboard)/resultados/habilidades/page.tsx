import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  type DashboardSkillsResponse,
  type DashboardFilterOptionsResponse,
  type SkillAchievementModel,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { Card, CardContent } from '@/components/ui/card';
import { AskAiButton, RegisterAssistantContext } from '@/components/assistant';
import { DashboardFilterBar } from '../components/dashboard-filter-bar';
import { parseDashboardFilters, buildDashboardQuery } from '../components/dashboard-filters';
import { dashboardFiltersToAssistantRefs } from '../components/assistant-context';
import { ResultadosNav } from '../components/resultados-nav';
import { PerformanceBadge } from '../components/performance-badge';
import { PERFORMANCE_LEVEL_BAR_CLASS, formatAchievement } from '../components/performance-level';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/resultados/habilidades';

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

  const [skillsResponse, options] = await Promise.all([
    apiGet<DashboardSkillsResponse>(`/dashboards/skills${query}`),
    apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${query}`),
  ]);

  const skills = skillsResponse.skills;

  return (
    <PageContainer>
      <RegisterAssistantContext refs={dashboardFiltersToAssistantRefs(filters)} />
      <PageHeader
        title="Logro por habilidad"
        description="% de logro promedio por habilidad evaluada según la taxonomía (H6.5)."
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
        <div className="space-y-3">
          {skills.map((skill) => (
            <SkillRow key={skill.nodeId} skill={skill} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function SkillRow({ skill }: { skill: SkillAchievementModel }) {
  const pct = skill.averageAchievement ?? 0;
  const barClass = skill.performanceLevel
    ? PERFORMANCE_LEVEL_BAR_CLASS[skill.performanceLevel]
    : 'bg-muted-foreground/40';

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium leading-tight">{skill.nodeName}</p>
            <p className="text-xs text-muted-foreground">
              {[skill.nodeCode, skill.nodeType].filter(Boolean).join(' · ')}
              {' · '}
              {skill.studentsAssessed} alumnos
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tabular-nums">
              {formatAchievement(skill.averageAchievement)}
            </span>
            <PerformanceBadge level={skill.performanceLevel} />
          </div>
        </div>

        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Logro de ${skill.nodeName}`}
        >
          <div
            className={cn('h-full rounded-full transition-all', barClass)}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
