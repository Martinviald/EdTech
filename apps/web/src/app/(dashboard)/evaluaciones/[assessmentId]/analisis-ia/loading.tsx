import { CardSkeleton } from '@/components/shared';

export default function EvaluacionAnalisisIaLoading() {
  return (
    <div className="space-y-6">
      <CardSkeleton rows={4} />
      <CardSkeleton rows={4} />
    </div>
  );
}
