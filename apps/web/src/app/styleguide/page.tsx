import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Inbox,
  UserPlus,
  BarChart3,
  GraduationCap,
  DollarSign,
  Timer,
  AlertTriangle,
  GitBranch,
  Rocket,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import {
  AlertCallout,
  EmptyState,
  Field,
  HeaderIcon,
  HeaderLead,
  MetaItem,
  MetricsGroup,
  PageHeader,
  StatCard,
  StatusBadge,
  StatusDot,
  Stepper,
} from '@/components/shared';
import { FilterBarDemo } from './filter-bar-demo';
import { BRAND } from '@/lib/brand';

const PALETTE = [
  { label: 'primary', bg: 'bg-primary' },
  { label: 'secondary', bg: 'bg-secondary border' },
  { label: 'accent', bg: 'bg-accent' },
  { label: 'destructive', bg: 'bg-destructive' },
  { label: 'success', bg: 'bg-success' },
  { label: 'warning', bg: 'bg-warning' },
  { label: 'info', bg: 'bg-info' },
  { label: 'muted', bg: 'bg-muted border' },
  { label: 'background', bg: 'bg-background border' },
  { label: 'foreground', bg: 'bg-foreground' },
];

// Ramp de marca (Capa 1 · indigo) + acento violeta, vía var(--brand-*)/var(--violet-*).
const BRAND_RAMP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const VIOLET_RAMP = [100, 200, 400, 500, 600, 900];

// 4 niveles de logro (tokens de dominio --level-*).
const LEVELS = [
  { label: 'insufficient', bg: 'bg-level-insufficient', fg: 'text-level-insufficient-foreground' },
  { label: 'elementary', bg: 'bg-level-elementary', fg: 'text-level-elementary-foreground' },
  { label: 'adequate', bg: 'bg-level-adequate', fg: 'text-level-adequate-foreground' },
  { label: 'advanced', bg: 'bg-level-advanced', fg: 'text-level-advanced-foreground' },
];

// Escala de radios (derivan de --radius).
const RADII = [
  { label: 'sm', cls: 'rounded-sm' },
  { label: 'md', cls: 'rounded-md' },
  { label: 'lg', cls: 'rounded-lg' },
  { label: 'xl', cls: 'rounded-xl' },
  { label: 'full', cls: 'rounded-full' },
];

// Escala de elevación (sombras suaves en capas).
const SHADOWS = [
  { label: 'shadow-sm', cls: 'shadow-sm' },
  { label: 'shadow', cls: 'shadow' },
  { label: 'shadow-md', cls: 'shadow-md' },
  { label: 'shadow-lg', cls: 'shadow-lg' },
  { label: 'shadow-xl', cls: 'shadow-xl' },
];

// Escala tipográfica tokenizada (roles + 2xs).
const TYPE_SCALE = [
  { label: 'text-display', cls: 'text-display', sample: 'Display' },
  { label: 'text-heading', cls: 'text-heading', sample: 'Heading' },
  { label: 'text-title', cls: 'text-title', sample: 'Title' },
  { label: 'text-body', cls: 'text-body', sample: 'Body — párrafo estándar.' },
  { label: 'text-caption', cls: 'text-caption text-muted-foreground', sample: 'Caption — metadatos.' },
  { label: 'text-2xs', cls: 'text-2xs text-muted-foreground', sample: 'text-2xs — 10px (cierra text-[10px]/[11px]).' },
];

export default function StyleguidePage() {
  return (
    <main className="p-8 space-y-14 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Design System — {BRAND.name}</h1>
        <p className="text-muted-foreground mt-1">
          Referencia visual de componentes, colores y tipografía.
        </p>
      </div>

      {/* Paleta */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Paleta de Colores</h2>
        <div className="flex gap-3 flex-wrap">
          {PALETTE.map(({ label, bg }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <div className={`w-16 h-16 rounded-lg ${bg}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Ramp de marca (Capa 1) */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Ramp de marca (indigo + violeta)</h2>
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">brand · indigo (--brand-*)</p>
          <div className="flex gap-1 flex-wrap">
            {BRAND_RAMP.map((step) => (
              <div key={step} className="flex flex-col items-center gap-1">
                <div
                  className="w-12 h-12 rounded-md border"
                  style={{ backgroundColor: `hsl(var(--brand-${step}))` }}
                />
                <span className="text-2xs text-muted-foreground">{step}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">accent · violet (--violet-*)</p>
          <div className="flex gap-1 flex-wrap">
            {VIOLET_RAMP.map((step) => (
              <div key={step} className="flex flex-col items-center gap-1">
                <div
                  className="w-12 h-12 rounded-md border"
                  style={{ backgroundColor: `hsl(var(--violet-${step}))` }}
                />
                <span className="text-2xs text-muted-foreground">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Niveles de logro */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Niveles de logro (--level-*)</h2>
        <p className="text-sm text-muted-foreground">
          Token de dominio para los 4 niveles; distinguibles entre sí y del primario indigo.
        </p>
        <div className="flex gap-3 flex-wrap">
          {LEVELS.map(({ label, bg, fg }) => (
            <div
              key={label}
              className={`w-32 h-16 rounded-lg flex items-center justify-center text-sm font-medium ${bg} ${fg}`}
            >
              {label}
            </div>
          ))}
        </div>
      </section>

      {/* Colores categóricos */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Colores categóricos (--cat-*)</h2>
        <p className="text-sm text-muted-foreground">
          Paleta NO semántica para codificar categorías sin implicar estado (tipos de nodo de
          taxonomía, series de charts…). Uso: <code>bg-cat-N/15 text-cat-N</code>.
        </p>
        <div className="flex gap-2 flex-wrap">
          {[
            'bg-cat-1/15 text-cat-1',
            'bg-cat-2/15 text-cat-2',
            'bg-cat-3/15 text-cat-3',
            'bg-cat-4/15 text-cat-4',
            'bg-cat-5/15 text-cat-5',
            'bg-cat-6/15 text-cat-6',
          ].map((cls, i) => (
            <span
              key={cls}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
            >
              cat-{i + 1}
            </span>
          ))}
        </div>
      </section>

      {/* Radios */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Radios (--radius = 0.75rem)</h2>
        <div className="flex gap-6 flex-wrap items-end">
          {RADII.map(({ label, cls }) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <div className={`w-16 h-16 bg-secondary border ${cls}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Sombras */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Elevación (sombras suaves)</h2>
        <div className="flex gap-8 flex-wrap p-2">
          {SHADOWS.map(({ label, cls }) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <div className={`w-20 h-20 rounded-lg bg-card ${cls}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Tipografía */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Tipografía (Inter)</h2>
        <div className="space-y-3">
          {TYPE_SCALE.map(({ label, cls, sample }) => (
            <div key={label} className="flex items-baseline gap-4">
              <span className="w-28 shrink-0 text-2xs text-muted-foreground">{label}</span>
              <span className={cls}>{sample}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Buttons */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Buttons</h2>
        <div className="flex gap-3 flex-wrap items-center">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex gap-3 flex-wrap items-center">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>

      {/* Inputs */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Inputs</h2>
        <div className="space-y-3 max-w-sm">
          <Input placeholder="Texto normal" />
          <Input placeholder="Deshabilitado" disabled />
          <Input type="email" placeholder="correo@colegio.cl" />
          <Input type="password" placeholder="Contraseña" />
        </div>
      </section>

      {/* Cards */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Cards</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Resultados DIA</CardTitle>
              <CardDescription>Resumen del instrumento aplicado.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-primary">78.4%</p>
              <p className="text-sm text-muted-foreground">Promedio curso 3°A</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Alumnos evaluados</CardTitle>
              <CardDescription>Total de respuestas procesadas.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">32 / 35</p>
              <p className="text-sm text-muted-foreground">3 sin respuesta</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Dialog & Dropdown */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Dialog y Dropdown</h2>
        <div className="flex gap-4 flex-wrap">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Abrir Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirmar acción</DialogTitle>
                <DialogDescription>
                  Esta acción no se puede deshacer. ¿Deseas continuar?
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline">Cancelar</Button>
                <Button>Confirmar</Button>
              </div>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Abrir Menú</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Opciones</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Ver detalle</DropdownMenuItem>
              <DropdownMenuItem>Exportar Excel</DropdownMenuItem>
              <DropdownMenuItem>Exportar PDF</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">Eliminar</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {/* Badges */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Badges</h2>
        <div className="flex gap-3 flex-wrap items-center">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="info">Info</Badge>
        </div>
      </section>

      {/* Patrones */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold border-b pb-2">Patrones (components/shared)</h2>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">PageHeader</p>
          <div className="space-y-4 rounded-lg border p-4">
            <PageHeader
              title="Banco de Items"
              description="Encabezado de página estándar con acciones."
              actions={<Button>Acción</Button>}
            />
            <PageHeader
              icon={Rocket}
              title="Con ícono (mismo átomo que HeaderLead)"
              description="El ícono queda del alto de título + descripción juntos."
              actions={<Button variant="outline">Acción</Button>}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            HeaderLead / HeaderIcon (ícono + título + subtítulo, para CardHeader · DialogHeader · TabHeader)
          </p>
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-4">
              <HeaderIcon icon={Sparkles} variant="filled" tone="primary" className="size-10" />
              <HeaderIcon icon={ShieldCheck} variant="filled" tone="success" className="size-10" />
              <HeaderIcon icon={AlertTriangle} variant="filled" tone="warning" className="size-10" />
              <HeaderIcon icon={Rocket} variant="outlined" tone="primary" className="size-10" />
              <HeaderIcon icon={ShieldCheck} variant="outlined" tone="success" className="size-10" />
              <HeaderIcon icon={AlertTriangle} variant="outlined" tone="destructive" className="size-10" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-4">
                <HeaderLead
                  icon={Rocket}
                  title="Filled (default)"
                  description="Caja sólida con color de marca, como la del dashboard."
                />
              </div>
              <div className="rounded-lg border p-4">
                <HeaderLead
                  icon={ShieldCheck}
                  iconVariant="outlined"
                  iconTone="success"
                  title="Outlined · success"
                  description="Borde + tinte, para acentos más suaves."
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">StatCard (una métrica)</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="% Logro global"
              value="72,4 %"
              hint="Promedio del alcance filtrado"
              icon={BarChart3}
            />
            <StatCard
              label="Alumnos evaluados"
              value="1.284"
              icon={GraduationCap}
              trend={{ value: 8 }}
            />
            <StatCard label="Alertas" value="3" trend={{ value: -12, higherIsBetter: false }} />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            MetricsGroup (varias métricas en una card)
          </p>
          <MetricsGroup
            metrics={[
              { label: 'Costo total', value: 'US$ 12,40', icon: DollarSign },
              { label: 'Latencia promedio', value: '1,2 s', icon: Timer, trend: { value: -4.05 } },
              {
                label: 'Jobs fallidos',
                value: '2',
                icon: AlertTriangle,
                tone: 'danger',
              },
            ]}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">FilterBar</p>
          <FilterBarDemo />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">MetaItem / StatusDot</p>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4">
            <MetaItem icon={GitBranch}>main</MetaItem>
            <StatusDot tone="success">Activo</StatusDot>
            <StatusDot tone="warning">Pendiente</StatusDot>
            <StatusDot tone="danger">Bloqueado</StatusDot>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">StatusBadge (tonos semánticos)</p>
          <div className="flex gap-3 flex-wrap items-center">
            <StatusBadge tone="success">Publicado</StatusBadge>
            <StatusBadge tone="warning">Borrador</StatusBadge>
            <StatusBadge tone="info">Oficial</StatusBadge>
            <StatusBadge tone="neutral">Archivado</StatusBadge>
            <StatusBadge tone="danger">Bloqueado</StatusBadge>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">AlertCallout</p>
          <div className="space-y-3">
            <AlertCallout tone="info" title="Información">Mensaje informativo de contexto.</AlertCallout>
            <AlertCallout tone="success" title="Éxito">La operación se completó correctamente.</AlertCallout>
            <AlertCallout tone="warning" title="Atención">Revisa este punto antes de continuar.</AlertCallout>
            <AlertCallout tone="danger" title="Error">Algo salió mal con la solicitud.</AlertCallout>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Stepper</p>
          <div className="rounded-lg border p-4">
            <Stepper
              steps={[
                { id: 'a', label: 'Cargar archivo' },
                { id: 'b', label: 'Previsualizar' },
                { id: 'c', label: 'Confirmar' },
              ]}
              currentStep={1}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Field</p>
          <div className="max-w-sm rounded-lg border p-4 space-y-3">
            <Field label="Correo institucional" htmlFor="sg-email" required hint="Usa el dominio del colegio.">
              <Input id="sg-email" type="email" placeholder="profesor@colegio.cl" />
            </Field>
            <Field label="Nombre" htmlFor="sg-name" error="Este campo es obligatorio.">
              <Input id="sg-name" placeholder="Nombre" />
            </Field>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">EmptyState</p>
          <EmptyState
            icon={Inbox}
            title="Aún no hay datos"
            description="Cuando agregues elementos, aparecerán aquí."
            action={
              <Button>
                <UserPlus className="size-4" />
                Agregar
              </Button>
            }
          />
        </div>
      </section>
    </main>
  );
}
