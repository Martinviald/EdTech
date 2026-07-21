import {
  remedialGuideStudentContentSchema,
  remedialPracticeStudentContentSchema,
  remedialPlanStudentContentSchema,
  type RemedialGuideStudentContent,
  type RemedialPracticeStudentContent,
  type RemedialPlanStudentContent,
  type RemedialStudentContent,
} from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCallout } from '@/components/shared';

/**
 * Render de solo lectura de la versión ESTUDIANTE de un material remedial
 * (TKT-17 b). Muestra el mismo contenido generado ocultando la información
 * solo-profesor (diagnóstico de la brecha, estrategia pedagógica, notas docentes,
 * criterios de logro, conteo/agrupación). El proyector que decide qué es
 * solo-profesor vive en el backend (`toRemedialStudentContent`); aquí solo se
 * narra la forma reducida que ya llega filtrada.
 */
export function StudentContentDisplay({ content }: { content: RemedialStudentContent }) {
  const guide = remedialGuideStudentContentSchema.safeParse(content);
  if (guide.success) return <GuideStudentView content={guide.data} />;

  const practice = remedialPracticeStudentContentSchema.safeParse(content);
  if (practice.success) return <PracticeStudentView content={practice.data} />;

  const plan = remedialPlanStudentContentSchema.safeParse(content);
  if (plan.success) return <PlanStudentView content={plan.data} />;

  return (
    <AlertCallout tone="danger">
      El contenido del material tiene un formato inesperado.
    </AlertCallout>
  );
}

function GuideStudentView({ content }: { content: RemedialGuideStudentContent }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Objetivo</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-foreground">
          <p>{content.objective}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actividades</CardTitle>
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
            <CardTitle className="text-base">Materiales</CardTitle>
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
    </div>
  );
}

function PracticeStudentView({ content }: { content: RemedialPracticeStudentContent }) {
  const items = [...content.items].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Práctica: {content.skillFocus}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>{content.itemCount} ejercicios</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ejercicios</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay ejercicios en este set.</p>
          ) : (
            <ol className="space-y-3">
              {items.map((item) => (
                <li key={item.itemId} className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {item.position}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-sm text-foreground">{item.stem}</p>
                      {/* Alternativas para que el alumno responda. Sin marcar la
                          correcta ni mostrar la explicación (solo-profesor): todas
                          las opciones se ven idénticas. */}
                      {item.alternatives && item.alternatives.length > 0 ? (
                        <ul className="space-y-1.5">
                          {item.alternatives.map((alt) => (
                            <li
                              key={alt.key}
                              className="flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                            >
                              <span className="font-medium">{alt.key})</span>
                              <span className="min-w-0 flex-1">{alt.text}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PlanStudentView({ content }: { content: RemedialPlanStudentContent }) {
  const steps = [...content.sequence].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{content.groupLabel}</CardTitle>
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
