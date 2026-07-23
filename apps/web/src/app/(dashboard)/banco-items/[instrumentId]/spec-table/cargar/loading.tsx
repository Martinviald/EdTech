import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, CardSkeleton } from '@/components/shared';

export default function SpecTableUploadLoading() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <CardSkeleton rows={4} />
    </PageContainer>
  );
}
