import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HeaderIcon } from './HeaderIcon';
import type { HeaderIconVariant, HeaderIconTone } from './header-icon.consts';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Ícono a la izquierda del bloque de título (mismo átomo que `HeaderLead`). */
  icon?: LucideIcon;
  iconVariant?: HeaderIconVariant;
  iconTone?: HeaderIconTone;
  /** Línea superior con icono + etiqueta, por encima del título (eyebrow). */
  eyebrow?: React.ReactNode;
  /** Badges inline a la derecha del título (estado, tipo, visibilidad…). */
  badges?: React.ReactNode;
  /** Fila de metadata bajo la descripción (repo, rama, estado, fecha…). Componer con `MetaItem`/`StatusDot`. */
  meta?: React.ReactNode;
  /** Acciones alineadas a la derecha (botones, dialogs trigger, etc.). */
  actions?: React.ReactNode;
  /**
   * Barra de pestañas bajo el encabezado (`<PageTabs>`), para tabs NO sticky.
   * Para tabs sticky, renderiza `<PageTabs sticky />` como HERMANO del
   * PageHeader dentro del `PageContainer` (no en este slot): `position: sticky`
   * se acota a la caja del padre, y este slot vive dentro del header (corto).
   */
  tabs?: React.ReactNode;
  /** Slot para breadcrumbs por encima del título. */
  breadcrumb?: React.ReactNode;
  /**
   * `primary` (default): título grande (`h1`). `secondary`: título más chico
   * (`h2`), para sub-encabezados dentro de un hub que ya tiene un header de
   * sección arriba (p. ej. cada tab bajo "Panorama pedagógico").
   */
  variant?: 'primary' | 'secondary';
  className?: string;
}

/**
 * Encabezado de página estándar. Slots opcionales (todos `ReactNode`, por
 * composición) que cubren desde la lista simple hasta el detalle rico:
 * breadcrumb · eyebrow · título + badges · descripción · fila de metadata ·
 * acciones a la derecha · pestañas abajo. Unifica el patrón que hoy se reescribe
 * inline en cada vista.
 */
export function PageHeader({
  title,
  description,
  icon,
  iconVariant,
  iconTone,
  eyebrow,
  badges,
  meta,
  actions,
  tabs,
  breadcrumb,
  variant = 'primary',
  className,
}: PageHeaderProps) {
  const TitleTag = variant === 'secondary' ? 'h2' : 'h1';
  const textColumn = (
    <div className="space-y-2">
      {eyebrow ? (
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          {eyebrow}
        </div>
      ) : null}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <TitleTag
            className={
              variant === 'secondary'
                ? 'text-base font-semibold'
                : 'text-xl font-semibold tracking-tight'
            }
          >
            {title}
          </TitleTag>
          {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
        </div>
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {meta ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">{meta}</div>
      ) : null}
    </div>
  );

  return (
    <div className={cn('space-y-3', className)}>
      {breadcrumb}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {icon ? (
          <div className="flex items-stretch gap-3">
            <HeaderIcon icon={icon} variant={iconVariant} tone={iconTone} />
            {textColumn}
          </div>
        ) : (
          textColumn
        )}
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
      {tabs}
    </div>
  );
}
