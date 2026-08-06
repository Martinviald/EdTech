import { FilterBarSkeleton, TableSkeleton } from '@/components/shared';

export default function TableroMaestroLoading() {
  return (
    <div className="space-y-4">
      <FilterBarSkeleton />
      <TableSkeleton rows={6} />
    </div>
  );
}
