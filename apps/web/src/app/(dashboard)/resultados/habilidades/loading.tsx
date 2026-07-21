import { Skeleton } from '@/components/ui/skeleton';
import { FilterBarSkeleton, CardSkeleton } from '@/components/shared';

export default function HabilidadesLoading() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <FilterBarSkeleton />
      <CardSkeleton rows={5} />
    </>
  );
}
