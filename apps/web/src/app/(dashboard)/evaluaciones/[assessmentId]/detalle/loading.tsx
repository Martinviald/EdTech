import { FilterBarSkeleton, TableSkeleton } from '@/components/shared';

export default function EvaluacionDetalleLoading() {
  return (
    <div className="space-y-6">
      <FilterBarSkeleton fields={1} className="sm:max-w-sm" />
      <TableSkeleton rows={8} />
    </div>
  );
}
