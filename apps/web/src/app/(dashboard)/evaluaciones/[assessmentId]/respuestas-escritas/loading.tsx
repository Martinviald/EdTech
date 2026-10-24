import { Skeleton } from '@/components/ui/skeleton';
import { WrittenAnswersSkeleton } from '@/components/answer-reading/WrittenAnswersReview';

export default function EvaluacionRespuestasEscritasLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full" />
      <WrittenAnswersSkeleton />
    </div>
  );
}
