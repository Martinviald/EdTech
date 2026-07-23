import { Skeleton } from '@/components/ui/skeleton';
import { FilterBarSkeleton, CardSkeleton } from '@/components/shared';

export default function EvaluacionMaterialRemedialLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-full" />
      <FilterBarSkeleton fields={2} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
      </div>
    </div>
  );
}
