import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { canAccess, ESTABLISHMENT_REPORT_ROLES } from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { PageContainer, PageHeader, EmptyState, TableSkeleton } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { EstablishmentReport } from '@/components/official-reports/establishment-report';
import { EstablishmentReportFilters } from '@/components/official-reports/establishment-report-filters';
import { PrintToolbar } from '@/components/official-reports/print-toolbar';
import { getEstablishmentFilterOptions, getEstablishmentReport } from './data';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/**
 * TKT-25 — Informe oficial de establecimiento (Área Académica). Formato agregado
 * por grado × asignatura para toda la organización (Tablas 1.1–1.9). Sólo para
 * roles directivos (`ESTABLISHMENT_REPORT_ROLES`); el `org_id` sale del token.
 *
 * El Área Socioemocional queda fuera de alcance (la plataforma no ingesta ese
 * cuestionario) — documentado en TKT-25.
 */
export default async function InformeEstablecimientoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ESTABLISHMENT_REPORT_ROLES)) redirect(ROUTES.dashboard);

  const sp = await searchParams;
  const academicYearId = pickParam(sp.academicYearId);
  const period = pickParam(sp.period);
  const basePath = ROUTES.establecimientoInformeOficial;

  const reportQuery = new URLSearchParams();
  if (academicYearId) reportQuery.set('academicYearId', academicYearId);
  if (period) reportQuery.set('period', period);
  const reportQs = reportQuery.toString();
  const querySuffix = reportQs ? `?${reportQs}` : '';

  return (
    <PageContainer>
      <PageHeader
        title="Informe oficial de establecimiento"
        description="Resultados agregados por grado y asignatura de toda la organización (Área Académica)."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Suspense fallback={<Skeleton className="h-10 w-56" />}>
          <FiltersSlot academicYearId={academicYearId} basePath={basePath} />
        </Suspense>
        <Suspense fallback={null}>
          <PrintToolbarSlot querySuffix={querySuffix} />
        </Suspense>
      </div>

      <Suspense fallback={<ReportSkeleton />}>
        <ReportBody querySuffix={querySuffix} />
      </Suspense>
    </PageContainer>
  );
}

async function FiltersSlot({
  academicYearId,
  basePath,
}: {
  academicYearId: string | undefined;
  basePath: string;
}) {
  const options = await getEstablishmentFilterOptions();
  if (!options) return <div />;
  return (
    <EstablishmentReportFilters
      academicYears={options.periods}
      value={{ academicYearId }}
      basePath={basePath}
    />
  );
}

async function PrintToolbarSlot({ querySuffix }: { querySuffix: string }) {
  const report = await getEstablishmentReport(querySuffix);
  return report ? <PrintToolbar /> : null;
}

async function ReportBody({ querySuffix }: { querySuffix: string }) {
  const report = await getEstablishmentReport(querySuffix);
  return report ? (
    <EstablishmentReport report={report} />
  ) : (
    <EmptyState
      icon={Inbox}
      title="No se pudo generar el informe de establecimiento"
      description="No hay resultados agregados para el año seleccionado, o no tienes acceso. Verifica que existan evaluaciones con resultados calculados."
    />
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <TableSkeleton rows={6} />
      <TableSkeleton rows={6} />
    </div>
  );
}
