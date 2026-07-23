import { Skeleton } from '@/components/ui/skeleton';
import { CardSkeleton } from '@/components/shared';

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="h-[92px] w-full rounded-xl" />
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CardSkeleton rows={5} />
        </div>
        <CardSkeleton rows={4} />
      </section>
    </div>
  );
}
