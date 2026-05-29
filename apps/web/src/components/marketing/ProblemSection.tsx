import { PAIN_POINTS } from './content';

export function ProblemSection() {
  return (
    <section className="container py-20 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Medir aprendizajes hoy es caro y lento
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Por eso los colegios miden poco. Y lo que miden, rara vez se transforma en
          decisiones a tiempo.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-3">
        {PAIN_POINTS.map((pain) => (
          <div
            key={pain.title}
            className="rounded-xl border border-border bg-card p-6 text-left"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <pain.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-lg font-semibold">{pain.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{pain.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
