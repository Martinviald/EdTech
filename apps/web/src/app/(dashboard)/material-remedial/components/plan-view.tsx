import type { RemedialPlanContent } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Render de solo lectura de un plan por grupo (H9.4). Sin PII: solo agregados. */
export function PlanView({ content }: { content: RemedialPlanContent }) {
  const steps = [...content.sequence].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{content.groupLabel}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-foreground">
          <p>
            Alumnos en el grupo:{' '}
            <span className="font-medium">{content.studentCount}</span>
          </p>
          <p className="text-muted-foreground">Brecha compartida: {content.sharedGap}</p>
          {content.estimatedSessions != null ? (
            <p className="text-muted-foreground">
              Sesiones estimadas: {content.estimatedSessions}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Secuencia remedial</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {steps.map((step) => (
              <li key={step.order} className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {step.order}
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{step.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
