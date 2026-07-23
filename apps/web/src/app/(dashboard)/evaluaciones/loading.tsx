import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, FilterBarSkeleton, TableSkeleton } from '@/components/shared';

export default function EvaluacionesLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <FilterBarSkeleton />
      <TableSkeleton />
    </PageContainer>
  );
}
