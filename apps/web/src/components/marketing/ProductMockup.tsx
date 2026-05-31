import { cn } from '@/lib/utils';

const KPIS = [
  { label: 'Logro promedio', value: '68%', tone: 'text-foreground' },
  { label: 'Alumnos evaluados', value: '512', tone: 'text-foreground' },
  { label: 'En riesgo', value: '47', tone: 'text-destructive' },
];

const SKILLS = [
  { name: 'Comprensión lectora', cells: [82, 74, 61, 55, 90] },
  { name: 'Localizar información', cells: [70, 48, 52, 80, 66] },
  { name: 'Reflexionar texto', cells: [45, 58, 72, 40, 63] },
  { name: 'Resolución problemas', cells: [88, 76, 50, 67, 71] },
];

/** Devuelve clases de heatmap según el % de logro (verde/ámbar/rojo vía tokens). */
function heatTone(value: number): string {
  if (value >= 75) return 'bg-success/80 text-success-foreground';
  if (value >= 55) return 'bg-primary/20 text-foreground';
  if (value >= 45) return 'bg-accent/30 text-foreground';
  return 'bg-destructive/70 text-destructive-foreground';
}

/**
 * Preview de producto construida con HTML/Tailwind (no imagen): KPIs +
 * heatmap de habilidades simulado. Nítido en cualquier resolución y coherente
 * con los tokens del design system.
 */
export function ProductMockup() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-2xl shadow-primary/5 sm:p-5">
      {/* Barra de ventana */}
      <div className="mb-4 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="ml-3 text-xs text-muted-foreground">
          Resultados DIA · Lenguaje · 4° Básico
        </span>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {KPIS.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-border bg-background p-3">
            <p className="truncate text-[11px] text-muted-foreground">{kpi.label}</p>
            <p className={cn('mt-1 text-xl font-bold tracking-tight', kpi.tone)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Heatmap por habilidad */}
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">Logro por habilidad</p>
          <span className="text-[10px] text-muted-foreground">5 cursos</span>
        </div>
        <div className="space-y-2">
          {SKILLS.map((skill) => (
            <div key={skill.name} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-[11px] text-muted-foreground sm:w-36">
                {skill.name}
              </span>
              <div className="flex flex-1 gap-1.5">
                {skill.cells.map((value, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex h-8 flex-1 items-center justify-center rounded text-[10px] font-semibold',
                      heatTone(value),
                    )}
                  >
                    {value}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
