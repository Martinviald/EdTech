import { FilterBarSkeleton, TableSkeleton } from '@/components/shared';

export default function EvaluacionDetalleLoading() {
  return (
    <div className="space-y-6">
      <FilterBarSkeleton />
      <TableSkeleton rows={8} />
    </div>
  );
}
