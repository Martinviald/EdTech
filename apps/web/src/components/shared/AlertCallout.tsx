import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_STYLES: Record<CalloutTone, { container: string; icon: string; defaultIcon: LucideIcon }> = {
  info: { container: 'border-info/30 bg-info/5', icon: 'text-info', defaultIcon: Info },
  success: {
    container: 'border-success/30 bg-success/5',
    icon: 'text-success',
    defaultIcon: CheckCircle2,
  },
  warning: {
    container: 'border-warning/40 bg-warning/10',
    icon: 'text-warning',
    defaultIcon: AlertTriangle,
  },
  danger: {
    container: 'border-destructive/30 bg-destructive/5',
    icon: 'text-destructive',
    defaultIcon: XCircle,
  },
};

interface AlertCalloutProps {
  tone?: CalloutTone;
  title?: string;
  /** Sobrescribe el icono por defecto del tono. */
  icon?: LucideIcon;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Caja de alerta/contexto tonal. Reemplaza los `div` con colores hardcodeados
 * (`bg-amber-50`, `bg-emerald-50`, …) usados para avisos, conflictos y mensajes
 * de éxito a lo largo de la app.
 */
export function AlertCallout({
  tone = 'info',
  title,
  icon,
  children,
  className,
}: AlertCalloutProps) {
  const styles = TONE_STYLES[tone];
  const Icon = icon ?? styles.defaultIcon;

  return (
    <div
      role="status"
      className={cn('flex gap-3 rounded-lg border p-4 text-sm', styles.container, className)}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', styles.icon)} aria-hidden />
      <div className="space-y-1">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
    </div>
  );
}
