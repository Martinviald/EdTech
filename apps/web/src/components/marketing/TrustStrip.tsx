const PLACEHOLDER_LOGOS = [
  'Colegio San José',
  'Liceo Bicentenario',
  'Instituto Andes',
  'Colegio Aurora',
  'Escuela Los Robles',
];

export function TrustStrip() {
  return (
    <section className="border-y border-border bg-secondary/30">
      <div className="container py-10">
        <p className="text-center text-sm font-medium text-muted-foreground">
          Diseñado para el sistema educativo chileno
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-70">
          {PLACEHOLDER_LOGOS.map((name) => (
            <span
              key={name}
              className="text-base font-semibold tracking-tight text-muted-foreground"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
