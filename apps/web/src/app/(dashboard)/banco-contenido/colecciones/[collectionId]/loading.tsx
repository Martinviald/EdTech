import { PageContainer } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';

export default function ColeccionDetailLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </PageContainer>
  );
}
