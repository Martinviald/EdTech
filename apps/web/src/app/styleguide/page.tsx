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
import { Inbox, UserPlus } from 'lucide-react';
import {
  AlertCallout,
  EmptyState,
  Field,
  PageHeader,
  StatusBadge,
  Stepper,
} from '@/components/patterns';
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

      {/* Tipografía */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b pb-2">Tipografía (Inter)</h2>
        <div className="space-y-2">
          <p className="text-4xl font-bold">Heading 1 — 36px Bold</p>
          <p className="text-3xl font-bold">Heading 2 — 30px Bold</p>
          <p className="text-2xl font-semibold">Heading 3 — 24px Semibold</p>
          <p className="text-xl font-semibold">Heading 4 — 20px Semibold</p>
          <p className="text-base">Body — 16px Regular. Texto de párrafo estándar.</p>
          <p className="text-sm text-muted-foreground">Small — 14px Muted. Texto secundario.</p>
          <p className="text-xs text-muted-foreground">XSmall — 12px. Etiquetas y metadatos.</p>
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
        <h2 className="text-xl font-semibold border-b pb-2">Patrones (components/patterns)</h2>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">PageHeader</p>
          <div className="rounded-lg border p-4">
            <PageHeader
              title="Banco de Items"
              description="Encabezado de página estándar con acciones."
              actions={<Button>Acción</Button>}
            />
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
