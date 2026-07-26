import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  /** Tono del icono: `neutral` (default) o `success` (verde, para estados "todo bien"). */
  tone?: 'neutral' | 'success';
  /** `sm` (default, compacto) o `lg` (más alto, para estados vacíos de página completa). */
  size?: 'sm' | 'lg';
  className?: string;
}

/**
 * Estado vacío estándar. Único patrón de "sin datos" de la app: reemplaza los
 * `div` con `border-dashed` inline que estaban duplicados en varias tablas.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  tone = 'neutral',
  size = 'sm',
  className,
}: EmptyStateProps) {
  const sm = size === 'sm';
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-6 text-center',
        sm ? 'gap-2 py-6' : 'gap-3 py-12',
        className,
      )}
    >
      {Icon ? (
        <div
          className={cn(
            'rounded-full',
            tone === 'success' ? 'bg-success/10' : 'bg-muted',
            sm ? 'p-2' : 'p-3',
          )}
        >
          <Icon
            className={cn(
              tone === 'success' ? 'text-success' : 'text-muted-foreground',
              sm ? 'size-6' : 'size-8',
            )}
            aria-hidden
          />
        </div>
      ) : null}
      <h3 className={cn('font-medium text-foreground', sm ? 'text-sm' : 'text-base')}>{title}</h3>
      {description ? (
        <p className={cn('max-w-md text-muted-foreground', sm ? 'text-xs' : 'text-sm')}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
