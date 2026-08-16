import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/shared';

export function EditorBodySkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="ml-auto h-9 w-56" />
      </div>
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </div>
  );
}

export default function MaterialEditorLoading() {
  return (
    <PageContainer>
      <EditorBodySkeleton />
    </PageContainer>
  );
}
