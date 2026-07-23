import { Skeleton } from '@/components/ui/skeleton';
import {
  PageContainer,
  FilterBarSkeleton,
  CardSkeleton,
} from '@/components/shared';

export default function MaterialRemedialLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-16 w-full" />
      <FilterBarSkeleton fields={2} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
      </div>
    </PageContainer>
  );
}
