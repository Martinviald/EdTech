import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/shared';

export default function HojasLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-44" />
        <TableSkeleton />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-44" />
        <TableSkeleton />
      </div>
    </div>
  );
}
