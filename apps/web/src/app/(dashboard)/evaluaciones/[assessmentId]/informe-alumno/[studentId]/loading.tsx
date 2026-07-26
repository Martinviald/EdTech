import { Skeleton } from '@/components/ui/skeleton';
import { CardSkeleton } from '@/components/shared';

export default function InformeAlumnoLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-48" />
      <CardSkeleton rows={6} />
    </div>
  );
}
