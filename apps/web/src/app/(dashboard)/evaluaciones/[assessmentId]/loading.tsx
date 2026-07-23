import { KpiGridSkeleton, CardSkeleton } from '@/components/shared';

export default function EvaluacionResumenLoading() {
  return (
    <div className="space-y-6">
      <KpiGridSkeleton />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
      </div>
    </div>
  );
}
