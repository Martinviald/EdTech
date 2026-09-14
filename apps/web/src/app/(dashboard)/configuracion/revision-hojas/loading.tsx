import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, CardSkeleton } from '@/components/shared';

export default function RevisionHojasLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-9 w-full max-w-lg" />
      <CardSkeleton rows={2} />
      <CardSkeleton rows={3} />
    </PageContainer>
  );
}
