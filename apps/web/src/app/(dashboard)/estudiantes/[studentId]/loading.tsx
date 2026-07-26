import { PageContainer, CardSkeleton } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';

export default function EstudiantePanoramaLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-24 w-full" />
      <CardSkeleton rows={8} />
    </PageContainer>
  );
}
