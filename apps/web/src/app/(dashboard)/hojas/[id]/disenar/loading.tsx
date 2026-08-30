import { Skeleton } from '@/components/ui/skeleton';
import { KpiGridSkeleton } from '@/components/shared';

export default function DisenarLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <KpiGridSkeleton />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="aspect-[17/22] w-full rounded-md" />
        <Skeleton className="aspect-[17/22] w-full rounded-md" />
      </div>
    </div>
  );
}
