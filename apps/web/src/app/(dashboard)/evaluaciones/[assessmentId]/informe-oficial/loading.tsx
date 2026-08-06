import { FilterBarSkeleton, CardSkeleton } from '@/components/shared';

export default function InformeOficialLoading() {
  return (
    <div className="space-y-6">
      <FilterBarSkeleton fields={1} className="sm:max-w-sm" />
      <CardSkeleton rows={6} />
    </div>
  );
}
