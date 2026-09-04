import { Skeleton } from '@/components/ui/skeleton';
import { CardSkeleton, TableSkeleton } from '@/components/shared';

export default function ImprimirLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <CardSkeleton />
      <div className="space-y-3">
        <Skeleton className="h-5 w-44" />
        <TableSkeleton />
      </div>
    </div>
  );
}
