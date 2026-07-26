import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, CardSkeleton } from '@/components/shared';

export default function MarcosAcademicosLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {Array.from({ length: 2 }).map((_, section) => (
        <section key={section} className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, card) => (
              <CardSkeleton key={card} rows={2} />
            ))}
          </div>
        </section>
      ))}
    </PageContainer>
  );
}
