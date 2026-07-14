import Link from 'next/link';
import { Lightbulb, ListChecks, Target, Users } from 'lucide-react';
import type { RemedialMaterialType, SkillDiagnosis } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/patterns';
import { formatAchievement } from './format';

/**
 * Enlace al flujo de generación (`generate=1`) de material remedial para una brecha.
 * Preserva la trazabilidad al análisis IA de origen (`sourceAnalysisId`) además del
 * nodo y la evaluación, para que el material quede anclado al diagnóstico que lo motivó.
 */
function buildGenerateHref(params: {
  nodeId: string;
  nodeName: string;
  assessmentId: string;
  analysisId: string;
  type: RemedialMaterialType;
}): string {
  const search = new URLSearchParams({
    nodeId: params.nodeId,
    nodeName: params.nodeName,
    assessmentId: params.assessmentId,
    sourceAnalysisId: params.analysisId,
    type: params.type,
    generate: '1',
  });
  return `/material-remedial?${search.toString()}`;
}

/** Brechas por habilidad con causa raíz, misconcepción y estrategia (H20.4). */
export function SkillGapsCard({
  skillGaps,
  assessmentId,
  analysisId,
}: {
  skillGaps: SkillDiagnosis[];
  assessmentId: string;
  /** Id del análisis IA que renderiza estas brechas: ancla el material generado al diagnóstico. */
  analysisId: string;
}) {
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

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={buildGenerateHref({
                      nodeId: gap.nodeId,
                      nodeName: gap.nodeName,
                      assessmentId,
                      analysisId,
                      type: 'guide',
                    })}
                  >
                    <Lightbulb className="mr-2 size-4" aria-hidden />
                    Generar guía
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link
                    href={buildGenerateHref({
                      nodeId: gap.nodeId,
                      nodeName: gap.nodeName,
                      assessmentId,
                      analysisId,
                      type: 'practice_set',
                    })}
                  >
                    <ListChecks className="mr-2 size-4" aria-hidden />
                    Generar ejercicios
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
