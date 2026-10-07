import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { canAccess, ESTABLISHMENT_REPORT_ROLES } from '@soe/types';
import { canSeeBenchmark } from '@/lib/benchmark-samples';
import { ROUTES } from '@/lib/routes';
import {
  EstablishmentReportSection,
  EstablishmentReportSkeleton,
} from '@/components/official-reports/establishment-report-section';

export const dynamic = 'force-dynamic';

export default async function ProcesoInformeEstablecimientoPage({
  params,
}: {
  params: Promise<{ processId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  const { processId } = await params;
  if (!canAccess(session.user.roles, ESTABLISHMENT_REPORT_ROLES)) {
    redirect(ROUTES.proceso(processId));
  }

  return (
    <Suspense fallback={<EstablishmentReportSkeleton />}>
      <EstablishmentReportSection
        processId={processId}
        canSeeSample={canSeeBenchmark(session.user.roles)}
      />
    </Suspense>
  );
}
