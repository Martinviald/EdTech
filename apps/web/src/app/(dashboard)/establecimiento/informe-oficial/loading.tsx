import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/shared';
import { EstablishmentReportSkeleton } from '@/components/official-reports/establishment-report-section';

export default function InformeEstablecimientoLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-80 max-w-full" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-20 w-full max-w-md" />
      <EstablishmentReportSkeleton />
    </PageContainer>
  );
}
