import { KpiGridSkeleton, CardSkeleton } from '@/components/shared';

export default function EvaluacionCalidadLoading() {
  return (
    <div className="space-y-6">
      <KpiGridSkeleton count={3} />
      <CardSkeleton rows={6} />
    </div>
  );
}
