import { ListChecks } from 'lucide-react';
import type { AiRecommendation, UserRole } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared';
import { priorityLabel, priorityTone, priorityRank } from './format';

interface RecommendationsCardProps {
  recommendations: AiRecommendation[];
  activeRole: UserRole;
}

/**
 * Recomendaciones priorizadas y por audiencia (H20.5). Las dirigidas a la
 * audiencia del rol activo se muestran primero; el resto queda al final.
 */
export function RecommendationsCard({
  recommendations,
  activeRole,
}: RecommendationsCardProps) {
  const targetAudience: AiRecommendation['audience'] =
    activeRole === 'teacher' ? 'teacher' : 'director';

  const sorted = [...recommendations].sort((a, b) => {
    const aPrimary = a.audience === targetAudience ? 0 : 1;
    const bPrimary = b.audience === targetAudience ? 0 : 1;
    if (aPrimary !== bPrimary) return aPrimary - bPrimary;
    return priorityRank(a.priority) - priorityRank(b.priority);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="size-5 text-primary" aria-hidden />
          Recomendaciones priorizadas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.length === 0 ? (
          <EmptyState title="Sin recomendaciones" />
        ) : (
          sorted.map((rec, idx) => (
            <div key={idx} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{rec.title}</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant={priorityTone(rec.priority)}>
                    Prioridad {priorityLabel(rec.priority)}
                  </Badge>
                  <Badge variant="outline">
                    {rec.audience === 'teacher' ? 'Profesor' : 'Directivo'}
                  </Badge>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{rec.rationale}</p>
              {rec.suggestedActions.length > 0 ? (
                <ul className="mt-3 list-inside list-disc space-y-0.5 text-sm text-foreground">
                  {rec.suggestedActions.map((action, i) => (
                    <li key={i}>{action}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
