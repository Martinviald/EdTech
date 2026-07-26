import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface MetaItemProps {
  /** Icono opcional a la izquierda del texto. */
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}

/**
 * Ítem de la fila de metadata de un encabezado (repo, rama, fecha, autor…).
 * Texto atenuado con icono opcional. Se agrupan varios en el slot `meta` de
 * `PageHeader`.
 */
export function MetaItem({ icon: Icon, children, className }: MetaItemProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
    >
      {Icon ? <Icon /> : null}
      {children}
    </span>
  );
}
