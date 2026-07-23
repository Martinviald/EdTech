import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, KpiGridSkeleton, CardSkeleton } from '@/components/shared';

export default function PreviewLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <KpiGridSkeleton />
      <CardSkeleton rows={2} />
      <CardSkeleton rows={6} />
    </PageContainer>
  );
}
