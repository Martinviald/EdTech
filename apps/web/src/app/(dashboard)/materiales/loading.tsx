import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, TableSkeleton } from '@/components/shared';

export default function MaterialesLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-[190px]" />
        <Skeleton className="h-10 w-[150px]" />
        <Skeleton className="h-10 w-[180px]" />
        <Skeleton className="h-10 w-[160px]" />
      </div>
      <TableSkeleton />
    </PageContainer>
  );
}
