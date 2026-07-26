import { KpiGridSkeleton, CardSkeleton } from '@/components/shared';

export default function AdminOrgProfileLoading() {
  return (
    <div className="space-y-6">
      <KpiGridSkeleton count={3} />
      <CardSkeleton rows={4} />
    </div>
  );
}
