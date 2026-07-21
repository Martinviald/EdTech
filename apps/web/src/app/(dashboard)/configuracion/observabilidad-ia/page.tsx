import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { canAccess, AI_OBSERVABILITY_VIEWER_ROLES } from '@soe/types';
import { PageContainer, TableSkeleton } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfigHubHeader } from '../components/ConfigHubHeader';
import { SummaryCards } from './components/summary-cards';
import { BudgetBar } from './components/budget-bar';
import { BreakdownTable } from './components/breakdown-table';
import { CostTimeseries } from './components/cost-timeseries';
import { getAiBudget, getAiCostTimeseries, getAiObservabilitySummary } from './data';

// ─────────────────────────────────────────────────────────────────────────────
// H19.25 — Observabilidad de costo/latencia IA. Server Component: resuelve auth +
// acceso (sólo directivos / platform_admin) y streamea por sección (shell
// instantáneo) el resumen, el estado de presupuesto y la serie temporal del gasto
// IA de la org del token. Sólo lectura de datos persistidos — no dispara llamadas
// al LLM.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

export default async function ObservabilidadIaPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, AI_OBSERVABILITY_VIEWER_ROLES)) {
    redirect(ROUTES.dashboard);
  }

  return (
    <PageContainer>
      <ConfigHubHeader description="Costo, tokens y latencia del uso de IA de tu colegio (Análisis IA y Material remedial), con seguimiento del presupuesto mensual. Sólo lectura — no genera gasto adicional (E20 — H19.25)." />

      <Suspense fallback={<BudgetBarSkeleton />}>
        <BudgetSection />
      </Suspense>

      <Suspense fallback={<SummaryCardsSkeleton />}>
        <SummarySection />
      </Suspense>

      <Suspense fallback={<TimeseriesSkeleton />}>
        <TimeseriesSection />
      </Suspense>

      <Suspense fallback={<BreakdownGridSkeleton />}>
        <BreakdownSection />
      </Suspense>
    </PageContainer>
  );
}

async function BudgetSection() {
  const budget = await getAiBudget();
  return <BudgetBar budget={budget} />;
}

async function SummarySection() {
  const summary = await getAiObservabilitySummary();
  return <SummaryCards totals={summary.totals} from={summary.from} to={summary.to} />;
}

async function TimeseriesSection() {
  const timeseries = await getAiCostTimeseries();
  return <CostTimeseries timeseries={timeseries} />;
}

async function BreakdownSection() {
  const summary = await getAiObservabilitySummary();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <BreakdownTable title="Por origen" buckets={summary.bySource} />
      <BreakdownTable title="Por tipo" buckets={summary.byType} />
      <BreakdownTable title="Por modelo" buckets={summary.byModel} />
    </div>
  );
}

function BudgetBarSkeleton() {
  return (
    <Card hover={false}>
      <CardContent className="space-y-3 p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-full" />
      </CardContent>
    </Card>
  );
}

function SummaryCardsSkeleton() {
  return (
    <section className="space-y-3">
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-[92px] w-full rounded-xl" />
    </section>
  );
}

function TimeseriesSkeleton() {
  return (
    <Card hover={false}>
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[180px] w-full" />
      </CardContent>
    </Card>
  );
}

function BreakdownGridSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <TableSkeleton rows={4} />
      <TableSkeleton rows={4} />
      <TableSkeleton rows={4} />
    </div>
  );
}
