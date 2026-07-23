import { FilterBarSkeleton, CardSkeleton } from '@/components/shared';

export default function InformeOficialLoading() {
  return (
    <div className="space-y-6">
      <FilterBarSkeleton />
      <CardSkeleton rows={6} />
    </div>
  );
}
