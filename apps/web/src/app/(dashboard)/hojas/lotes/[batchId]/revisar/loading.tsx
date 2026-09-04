import { Skeleton } from '@/components/ui/skeleton';
import { CardSkeleton } from '@/components/shared';

export default function RevisarLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
