import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Acciones alineadas a la derecha (botones, dialogs trigger, etc.). */
  actions?: React.ReactNode;
  /** Slot para breadcrumbs por encima del título (implementación futura). */
  breadcrumb?: React.ReactNode;
  className?: string;
}

/**
 * Encabezado de página estándar: breadcrumb opcional + título + descripción
 * y acciones a la derecha. Unifica el patrón que hoy se reescribe inline en
 * cada vista del dashboard/admin.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {breadcrumb}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}
