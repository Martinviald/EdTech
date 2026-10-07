import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { CalendarRange } from 'lucide-react';
import { auth } from '@/auth';
import { canAccess, ESTABLISHMENT_REPORT_ROLES } from '@soe/types';
import { canSeeBenchmark } from '@/lib/benchmark-samples';
import { ROUTES } from '@/lib/routes';
import { PageContainer, PageHeader, EmptyState } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';
import {
  EstablishmentReportSection,
  EstablishmentReportSkeleton,
} from '@/components/official-reports/establishment-report-section';
import { EstablishmentReportProcessPicker } from '@/components/official-reports/establishment-report-process-picker';
import { getEstablishmentProcessOptions } from './data';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Informe del establecimiento (Área Académica) de un proceso de medición. Sin
 * `processId` muestra el selector de procesos de la org; el informe nunca se
 * calcula por año porque mezclaría instrumentos y momentos no comparables.
 */
export default async function InformeEstablecimientoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ESTABLISHMENT_REPORT_ROLES)) redirect(ROUTES.dashboard);

  const processId = pickParam((await searchParams).processId);

  return (
    <PageContainer>
      <div className="print:hidden">
        <PageHeader
          title="Informe del establecimiento"
          description="Resultados agregados por grado y asignatura de un proceso de medición."
        />
      </div>

      <Suspense fallback={<Skeleton className="h-20 w-full max-w-md" />}>
        <ProcessPickerSlot processId={processId} />
      </Suspense>

      {processId ? (
        <Suspense key={processId} fallback={<EstablishmentReportSkeleton />}>
          <EstablishmentReportSection
            processId={processId}
            canSeeSample={canSeeBenchmark(session.user.roles)}
          />
        </Suspense>
      ) : (
        <EmptyState
          icon={CalendarRange}
          title="Elige un proceso de medición"
          description="El informe del establecimiento se calcula por proceso, para no mezclar resultados de instrumentos o momentos distintos."
        />
      )}
    </PageContainer>
  );
}

async function ProcessPickerSlot({ processId }: { processId: string | undefined }) {
  const response = await getEstablishmentProcessOptions();
  const processes = (response?.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    academicYear: p.academicYear,
    period: p.period,
  }));
  return (
    <EstablishmentReportProcessPicker
      processes={processes}
      value={processId}
      basePath={ROUTES.establecimientoInformeOficial}
    />
  );
}
