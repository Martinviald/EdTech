import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, CardSkeleton } from '@/components/shared';

export default function ImportarResultadosLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <CardSkeleton rows={3} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} rows={2} />
        ))}
      </div>
    </PageContainer>
  );
}
