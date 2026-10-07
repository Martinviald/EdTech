import { Skeleton } from '@/components/ui/skeleton';
import { CompactFilterBarSkeleton, TableSkeleton } from '@/components/shared';

export default function MapaCalorLoading() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <CompactFilterBarSkeleton />
      <TableSkeleton rows={6} />
    </>
  );
}
