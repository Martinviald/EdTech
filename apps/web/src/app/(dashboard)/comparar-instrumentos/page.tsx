import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { getDisplayMessage } from '@/lib/errors';
import { isFeatureEnabled } from '@/lib/features';
import { ROUTES } from '@/lib/routes';
import {
  AI_ANALYSIS_GENERATOR_ROLES,
  COMPARE_RESULTS_VIEWER_ROLES,
  assessmentComparisonCohortSchema,
  canAccess,
  type AssessmentComparisonCandidatesResponse,
  type AssessmentComparisonCohort,
  type AssessmentComparisonResponse,
  type AssessmentListResponse,
} from '@soe/types';
import { AlertCallout, CardSkeleton, PageContainer } from '@/components/shared';
import { ComparisonSelector } from './components/comparison-selector';
import { ComparisonResults } from './components/comparison-results';
import { AiComparisonPanel, type AiAudience } from './components/ai-comparison-panel';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const AUDIENCES: readonly AiAudience[] = ['general', 'director', 'teacher'];

function pick(params: SearchParams, key: string): string | null {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : null;
}

function parseCohort(value: string | null): AssessmentComparisonCohort {
  const parsed = assessmentComparisonCohortSchema.safeParse(value);
  return parsed.success ? parsed.data : 'paired';
}

function parseAudience(value: string | null): AiAudience {
  return AUDIENCES.find((a) => a === value) ?? 'general';
}

export default async function CompararInstrumentosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, COMPARE_RESULTS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const baseId = pick(params, 'baseId');
  const comparisonId = pick(params, 'comparisonId');
  const cohort = parseCohort(pick(params, 'cohort'));
  const audience = parseAudience(pick(params, 'audience'));
  const canUseAi = canAccess(session.user.roles, AI_ANALYSIS_GENERATOR_ROLES);

  return (
    <PageContainer>
      <Suspense fallback={<CardSkeleton rows={2} />}>
        <SelectionSection baseId={baseId} comparisonId={comparisonId} />
      </Suspense>

      {baseId && comparisonId ? (
        <Suspense
          fallback={
            <div className="space-y-4">
              <CardSkeleton rows={2} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CardSkeleton rows={3} />
                <CardSkeleton rows={3} />
              </div>
            </div>
          }
        >
          <ComparisonSection
            baseId={baseId}
            comparisonId={comparisonId}
            cohort={cohort}
            audience={audience}
            canUseAi={canUseAi}
          />
        </Suspense>
      ) : null}
    </PageContainer>
  );
}

async function SelectionSection({
  baseId,
  comparisonId,
}: {
  baseId: string | null;
  comparisonId: string | null;
}) {
  if (baseId) {
    const candidates = await apiGet<AssessmentComparisonCandidatesResponse>(
      `/assessment-comparisons/candidates?baseAssessmentId=${encodeURIComponent(baseId)}`,
    ).catch(() => null);
    if (candidates) {
      return (
        <ComparisonSelector
          mode="comparison"
          base={candidates.base}
          candidates={candidates.data}
          comparisonId={comparisonId}
        />
      );
    }
  }

  const options = await apiGet<AssessmentListResponse>('/item-analysis/assessments');
  return (
    <ComparisonSelector mode="base" baseOptions={options.data} baseNotFound={baseId !== null} />
  );
}

async function ComparisonSection({
  baseId,
  comparisonId,
  cohort,
  audience,
  canUseAi,
}: {
  baseId: string;
  comparisonId: string;
  cohort: AssessmentComparisonCohort;
  audience: AiAudience;
  canUseAi: boolean;
}) {
  const qs = new URLSearchParams({
    baseAssessmentId: baseId,
    comparisonAssessmentId: comparisonId,
    cohort,
  });

  let comparison: AssessmentComparisonResponse;
  try {
    comparison = await apiGet<AssessmentComparisonResponse>(`/assessment-comparisons?${qs}`);
  } catch (error) {
    return (
      <AlertCallout tone="danger" title="No se pudo comparar">
        {getDisplayMessage(error, 'No se pudo cargar la comparación. Vuelve a intentarlo.')}
      </AlertCallout>
    );
  }

  const aiEnabled = canUseAi ? await isFeatureEnabled('ai_analysis') : false;

  return (
    <div className="space-y-6">
      {canUseAi ? (
        <AiComparisonPanel
          key={`${baseId}-${comparisonId}`}
          base={comparison.base}
          comparison={comparison.comparison}
          featureEnabled={aiEnabled}
          initialAudience={audience}
        />
      ) : null}
      <ComparisonResults data={comparison} requestedCohort={cohort} />
    </div>
  );
}
