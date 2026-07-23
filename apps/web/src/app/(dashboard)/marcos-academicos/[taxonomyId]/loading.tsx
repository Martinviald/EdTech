import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, TableSkeleton } from '@/components/shared';

export default function MarcoAcademicoDetailLoading() {
  return (
    <PageContainer>
      <Skeleton className="h-4 w-52" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <TableSkeleton rows={8} />
    </PageContainer>
  );
}
