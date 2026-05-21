import { cn } from '@soe/ui';

export default function HomePage() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-16">
      <div className="space-y-2 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Sistema Operativo Educativo</h1>
        <p className="text-muted-foreground">Plataforma EdTech con IA para colegios chilenos.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="📊 Dashboards" description="Resultados por habilidad, alumno y curso" />
        <Card title="🧠 Predicción ML" description="SIMCE / PAES / DIA con explicabilidad" />
        <Card title="✨ IA Remedial" description="Material personalizado por área débil" />
      </div>

      <p className="text-xs text-muted-foreground">Fase 1 — Sprint 0 · Cimientos arquitectónicos</p>
    </main>
  );
}

function Card({ title, description }: { title: string; description: string }) {
  return (
    <div
      className={cn('rounded-lg border bg-card p-6 shadow-sm transition-shadow hover:shadow-md')}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
