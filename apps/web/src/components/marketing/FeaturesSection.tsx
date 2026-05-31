import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FEATURES } from './content';

export function FeaturesSection() {
  return (
    <section id="producto" className="scroll-mt-20 border-t border-border bg-secondary/20">
      <div className="container py-20 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Todo lo que necesitas para el DIA, en una plataforma
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Desde la corrección automática hasta el análisis por habilidad. Nada de
            sistemas desconectados.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card
              key={feature.title}
              className="transition-shadow hover:shadow-md hover:shadow-primary/5"
            >
              <CardHeader>
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <feature.icon className="h-5 w-5" />
                </span>
                <CardTitle className="mt-4 text-lg">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
