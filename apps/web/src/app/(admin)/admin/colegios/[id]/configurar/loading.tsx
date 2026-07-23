import { Skeleton } from '@/components/ui/skeleton';
import { CardSkeleton } from '@/components/shared';

export default function AdminConfigurarLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <CardSkeleton rows={5} />
    </div>
  );
}
