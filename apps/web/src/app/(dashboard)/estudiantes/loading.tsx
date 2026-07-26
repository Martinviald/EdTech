import { PageContainer, CardSkeleton } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';

export default function EstudiantesLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-4 w-2/3 max-w-xl" />
      <Skeleton className="h-10 w-full sm:max-w-sm" />
      <CardSkeleton rows={6} />
    </PageContainer>
  );
}
