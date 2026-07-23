import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, TableSkeleton } from '@/components/shared';
import { Card, CardContent } from '@/components/ui/card';

export default function ObservabilidadIaLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <Card hover={false}>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>
      <Skeleton className="h-[92px] w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        <TableSkeleton rows={4} />
        <TableSkeleton rows={4} />
        <TableSkeleton rows={4} />
      </div>
    </PageContainer>
  );
}
