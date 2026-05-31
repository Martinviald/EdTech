import { STEPS } from './content';

export function HowItWorksSection() {
  return (
    <section id="como-funciona" className="scroll-mt-20">
      <div className="container py-20 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Del dato crudo a la decisión, en tres pasos
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Lo que antes tomaba semanas, ahora ocurre en una sesión.
          </p>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.step} className="relative text-center md:text-left">
              <div className="flex items-center justify-center gap-3 md:justify-start">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <step.icon className="h-6 w-6" />
                </span>
                <span className="text-3xl font-bold tracking-tight text-border">
                  {step.step}
                </span>
              </div>
              <h3 className="mt-5 text-xl font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
