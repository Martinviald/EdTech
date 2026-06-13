import { Target, Users } from 'lucide-react';
import type { SkillDiagnosis } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/patterns';
import { formatAchievement } from './format';

/** Brechas por habilidad con causa raíz, misconcepción y estrategia (H20.4). */
export function SkillGapsCard({ skillGaps }: { skillGaps: SkillDiagnosis[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-5 text-warning" aria-hidden />
          Brechas por habilidad
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {skillGaps.length === 0 ? (
          <EmptyState title="Sin brechas significativas detectadas" />
        ) : (
          skillGaps.map((gap) => (
            <div key={gap.nodeId} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{gap.nodeName}</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline">Logro {formatAchievement(gap.achievement)}</Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" aria-hidden />
                    {gap.remedialGroupSize} alumnos
                  </Badge>
                </div>
              </div>

              <div className="mt-3 space-y-2 text-sm">
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Causa raíz: </span>
                  {gap.rootCauseHypothesis}
                </p>
                {gap.misconceptionSignal ? (
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Señal de distractor: </span>
                    {gap.misconceptionSignal}
                  </p>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Estrategia de reenseñanza
                  </p>
                  <p className="mt-1 text-sm text-foreground">{gap.reteachStrategy}</p>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Actividad de ejemplo
                  </p>
                  <p className="mt-1 text-sm text-foreground">{gap.exampleActivity}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
