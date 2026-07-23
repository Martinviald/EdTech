import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, CardSkeleton } from '@/components/shared';

export default function EscalaDetailLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-4 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <CardSkeleton rows={5} />
        <CardSkeleton rows={5} />
      </div>
      <CardSkeleton rows={2} />
    </PageContainer>
  );
}
