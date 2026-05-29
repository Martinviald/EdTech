import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AI_CAPABILITIES } from './content';

export function AiSection() {
  return (
    <section className="container py-20 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Inteligencia artificial
        </span>
        <h2 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
          IA que propone, el humano aprueba
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          La IA acelera el trabajo pedagógico sin reemplazar el criterio docente. Siempre
          hay una persona que confirma.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-4xl gap-5 sm:grid-cols-2">
        {AI_CAPABILITIES.map((cap) => (
          <div
            key={cap.title}
            className={cn(
              'rounded-xl border p-6',
              cap.available
                ? 'border-primary/30 bg-primary/5'
                : 'border-border bg-card',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold">{cap.title}</h3>
              <Badge variant={cap.available ? 'default' : 'secondary'}>
                {cap.available ? 'Disponible' : 'Próximamente'}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{cap.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
