import { FilterBarSkeleton, KpiGridSkeleton, CardSkeleton } from '@/components/shared';

export default function EvaluacionResultadosLoading() {
  return (
    <div className="space-y-6">
      <FilterBarSkeleton />
      <KpiGridSkeleton />
      <CardSkeleton />
    </div>
  );
}
