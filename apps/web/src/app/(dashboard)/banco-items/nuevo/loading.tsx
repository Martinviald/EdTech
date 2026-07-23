import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, CardSkeleton } from '@/components/shared';

export default function NuevoInstrumentoLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="max-w-2xl space-y-6">
        <CardSkeleton rows={4} />
        <CardSkeleton rows={2} />
        <Skeleton className="h-10 w-40" />
      </div>
    </PageContainer>
  );
}
