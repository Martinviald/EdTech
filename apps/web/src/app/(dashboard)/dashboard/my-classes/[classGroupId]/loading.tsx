import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, TableSkeleton, CardSkeleton } from '@/components/shared';

export default function ClassGroupDetailLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-4 w-44" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <TableSkeleton rows={6} />
      <CardSkeleton rows={3} />
    </PageContainer>
  );
}
