import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  AI_OBSERVABILITY_VIEWER_ROLES,
  type AiBudgetStatus,
  type AiCostTimeseriesResponse,
  type AiObservabilitySummary,
} from '@soe/types';
import { PageContainer, PageHeader } from '@/components/patterns';
import { SummaryCards } from './components/summary-cards';
import { BudgetBar } from './components/budget-bar';
import { BreakdownTable } from './components/breakdown-table';
import { CostTimeseries } from './components/cost-timeseries';

// ─────────────────────────────────────────────────────────────────────────────
// H19.25 — Observabilidad de costo/latencia IA. Server Component: resuelve auth +
// acceso (sólo directivos / platform_admin) y carga en paralelo el resumen, el
// estado de presupuesto y la serie temporal del gasto IA de la org del token.
// Sólo lectura de datos persistidos — no dispara llamadas al LLM.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

export default async function ObservabilidadIaPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, AI_OBSERVABILITY_VIEWER_ROLES)) {
    redirect('/dashboard');
  }

  // Carga en paralelo. Los errores de API se propagan al error boundary del layout.
  const [summary, budget, timeseries] = await Promise.all([
    apiGet<AiObservabilitySummary>('/ai-observability/summary'),
    apiGet<AiBudgetStatus>('/ai-observability/budget'),
    apiGet<AiCostTimeseriesResponse>('/ai-observability/timeseries'),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Observabilidad IA"
        description="Costo, tokens y latencia del uso de IA de tu colegio (Análisis IA y Material remedial), con seguimiento del presupuesto mensual. Sólo lectura — no genera gasto adicional (E20 — H19.25)."
      />

      <BudgetBar budget={budget} />

      <SummaryCards totals={summary.totals} from={summary.from} to={summary.to} />

      <CostTimeseries timeseries={timeseries} />

      <div className="grid gap-4 lg:grid-cols-3">
        <BreakdownTable title="Por origen" buckets={summary.bySource} />
        <BreakdownTable title="Por tipo" buckets={summary.byType} />
        <BreakdownTable title="Por modelo" buckets={summary.byModel} />
      </div>
    </PageContainer>
  );
}
