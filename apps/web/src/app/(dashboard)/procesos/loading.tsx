import { CardSkeleton, PageContainer } from '@/components/shared';

export default function Loading() {
  return (
    <PageContainer>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CardSkeleton rows={3} />
        <CardSkeleton rows={3} />
        <CardSkeleton rows={3} />
      </div>
    </PageContainer>
  );
}
