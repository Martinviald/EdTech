import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, TableSkeleton } from '@/components/shared';

export default function SpecTableLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <TableSkeleton rows={8} />
    </PageContainer>
  );
}
