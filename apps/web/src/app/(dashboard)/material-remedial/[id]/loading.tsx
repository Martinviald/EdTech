import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, CardSkeleton } from '@/components/shared';

export default function MaterialRemedialDetailLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-5 w-40" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-6 w-24" />
      </div>
      <CardSkeleton rows={6} />
    </PageContainer>
  );
}
