import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, FilterBarSkeleton, CardSkeleton } from '@/components/shared';

export default function BenchmarkingLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <FilterBarSkeleton />
      <CardSkeleton rows={4} />
    </PageContainer>
  );
}
