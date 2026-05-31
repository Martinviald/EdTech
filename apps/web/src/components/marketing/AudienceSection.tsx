import { Check } from 'lucide-react';
import { AUDIENCES } from './content';

export function AudienceSection() {
  return (
    <section id="para-ti" className="scroll-mt-20 border-t border-border bg-secondary/20">
      <div className="container py-20 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Una plataforma, dos miradas
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Visibilidad macro para quien dirige. Eficiencia operativa para quien enseña.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-2">
          {AUDIENCES.map((audience) => (
            <div
              key={audience.title}
              className="rounded-2xl border border-border bg-card p-8"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <audience.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-xl font-semibold">{audience.title}</h3>
              <ul className="mt-5 space-y-3">
                {audience.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span className="text-muted-foreground">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
