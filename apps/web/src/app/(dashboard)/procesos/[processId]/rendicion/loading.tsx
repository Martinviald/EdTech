import { CardSkeleton, KpiGridSkeleton } from '@/components/shared';

export default function Loading() {
  return (
    <div className="space-y-6">
      <KpiGridSkeleton count={3} />
      <CardSkeleton rows={4} />
    </div>
  );
}
