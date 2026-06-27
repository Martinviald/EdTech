import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type OnboardingStep = {
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
};

/**
 * Checklist de puesta en marcha para quien configura el colegio. Cada paso se
 * marca como completado según señales reales y enlaza a su flujo. Se muestra solo
 * mientras la configuración esté incompleta.
 */
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const completed = steps.filter((s) => s.done).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Primeros pasos</CardTitle>
        <p className="text-sm text-muted-foreground">
          {completed} de {steps.length} completados · termina la configuración para empezar a ver
          resultados.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((step) => (
          <div key={step.title} className="flex items-start gap-3 rounded-lg border p-3">
            {step.done ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            ) : (
              <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm font-medium',
                  step.done && 'text-muted-foreground line-through',
                )}
              >
                {step.title}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
            </div>
            {!step.done ? (
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link href={step.href as Route}>
                  {step.cta}
                  <ArrowRight className="ml-1.5 size-3.5" aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
