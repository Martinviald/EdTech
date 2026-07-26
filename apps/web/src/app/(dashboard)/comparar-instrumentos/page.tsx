import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { canAccess, AI_ANALYSIS_GENERATOR_ROLES, type ComparableAssessment } from '@soe/types';
import { PageContainer, CardSkeleton } from '@/components/shared';
import { FeatureUpgradeNotice } from '@/components/feature-gate';
import { isFeatureEnabled } from '@/lib/features';
import { ROUTES } from '@/lib/routes';
import { ComparisonWorkbench } from './components/comparison-workbench';

// TKT-23 — Diagnóstico IA de la variación entre dos instrumentos comparables.
// Server Component: resuelve auth + acceso + feature flag y carga las evaluaciones
// candidatas. El flujo interactivo (selección + generación async + polling) vive
// en el Client Component `ComparisonWorkbench`.
export const dynamic = 'force-dynamic';

export default async function CompararInstrumentosPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, AI_ANALYSIS_GENERATOR_ROLES)) {
    redirect(ROUTES.dashboard);
  }
  if (!(await isFeatureEnabled('ai_analysis'))) {
    return <FeatureUpgradeNotice feature="ai_analysis" />;
  }

  return (
    <PageContainer>
      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CardSkeleton rows={3} />
            <CardSkeleton rows={3} />
          </div>
        }
      >
        <ComparisonSection />
      </Suspense>
    </PageContainer>
  );
}

async function ComparisonSection() {
  // Errores de API → error boundary de (dashboard)/error.tsx.
  const candidates = await apiGet<ComparableAssessment[]>(
    '/ai-analysis/compare-instruments/candidates',
  );

  return <ComparisonWorkbench candidates={candidates} />;
}
