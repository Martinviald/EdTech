import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HeaderIcon } from './HeaderIcon';
import type { HeaderIconVariant, HeaderIconTone } from './header-icon.consts';

interface HeaderLeadProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Ícono opcional a la izquierda; sin ícono, solo título + descripción. */
  icon?: LucideIcon;
  iconVariant?: HeaderIconVariant;
  iconTone?: HeaderIconTone;
  /** Elemento del título. `div` (default) para cards/dialogs; `h2`/`h3` cuando aporta semántica. */
  as?: 'h1' | 'h2' | 'h3' | 'div';
  titleClassName?: string;
  className?: string;
}

/**
 * Cluster reutilizable de encabezado: [ícono] + título + descripción. Se compone
 * dentro de `CardHeader`, `DialogHeader`, `TabHeader`, etc. El ícono queda del
 * alto de título+descripción juntos (fila `items-stretch` + `HeaderIcon` cuadrado).
 * `PageHeader` usa el mismo `HeaderIcon` pero arma su propia fila (tiene más slots).
 */
export function HeaderLead({
  title,
  description,
  icon,
  iconVariant,
  iconTone,
  as: TitleTag = 'div',
  titleClassName,
  className,
}: HeaderLeadProps) {
  return (
    <div className={cn('flex items-stretch gap-3', className)}>
      {icon ? <HeaderIcon icon={icon} variant={iconVariant} tone={iconTone} /> : null}
      <div className="flex min-w-0 flex-col justify-center gap-0.5">
        <TitleTag className={cn('text-base font-semibold leading-tight', titleClassName)}>
          {title}
        </TitleTag>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
