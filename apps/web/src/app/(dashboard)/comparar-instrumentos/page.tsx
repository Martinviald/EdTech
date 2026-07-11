import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { canAccess, AI_ANALYSIS_GENERATOR_ROLES, type ComparableAssessment } from '@soe/types';
import { PageContainer, PageHeader } from '@/components/patterns';
import { FeatureUpgradeNotice } from '@/components/feature-gate';
import { isFeatureEnabled } from '@/lib/features';
import { ComparisonWorkbench } from './components/comparison-workbench';

// TKT-23 — Diagnóstico IA de la variación entre dos instrumentos comparables.
// Server Component: resuelve auth + acceso + feature flag y carga las evaluaciones
// candidatas. El flujo interactivo (selección + generación async + polling) vive
// en el Client Component `ComparisonWorkbench`.
export const dynamic = 'force-dynamic';

export default async function CompararInstrumentosPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, AI_ANALYSIS_GENERATOR_ROLES)) {
    redirect('/dashboard');
  }
  if (!(await isFeatureEnabled('ai_analysis'))) {
    return <FeatureUpgradeNotice feature="ai_analysis" />;
  }

  // Errores de API → error boundary de (dashboard)/error.tsx.
  const candidates = await apiGet<ComparableAssessment[]>(
    '/ai-analysis/compare-instruments/candidates',
  );

  return (
    <PageContainer>
      <PageHeader
        title="Comparar instrumentos con IA"
        description="Ante una variación en el % de logro entre dos instrumentos comparables (p. ej. el mismo diagnóstico en dos años), la IA analiza el contenido y los resultados de ambos y propone una hipótesis de qué explica la diferencia. Es una hipótesis a validar, no una conclusión definitiva."
      />
      <ComparisonWorkbench candidates={candidates} />
    </PageContainer>
  );
}
