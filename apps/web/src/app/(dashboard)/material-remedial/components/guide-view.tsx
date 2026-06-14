import type { RemedialGuideContent } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Render de solo lectura de una guía de reenseñanza (H9.2). */
export function GuideView({ content }: { content: RemedialGuideContent }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Objetivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-foreground">
          <p>{content.objective}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Causa de la brecha</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-foreground">
          <p>{content.rootCauseSummary}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estrategia de reenseñanza</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-foreground">
          <p>{content.strategy}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actividades de clase</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {content.classActivities.map((activity, idx) => (
              <li key={idx} className="rounded-md border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{activity.title}</p>
                  {activity.durationMin != null ? (
                    <span className="text-xs text-muted-foreground">
                      {activity.durationMin} min
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{activity.description}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {content.materials.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Materiales sugeridos</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {content.materials.map((m, idx) => (
                <li key={idx}>{m}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {content.successCriteria.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Criterios de logro</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {content.successCriteria.map((c, idx) => (
                <li key={idx}>{c}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
