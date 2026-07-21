import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  HEADER_ICON_TONE_CLASS,
  type HeaderIconVariant,
  type HeaderIconTone,
} from './header-icon.consts';

interface HeaderIconProps {
  icon: LucideIcon;
  /** `filled` (caja sólida, como la imagen) u `outlined` (borde + tinte). */
  variant?: HeaderIconVariant;
  /** Color de marca/estado. Todos vienen de tokens semánticos. */
  tone?: HeaderIconTone;
  /** Se aplica al wrapper que estira; útil para fijar tamaño en uso aislado (`size-10`). */
  className?: string;
}

/**
 * Cajita de ícono de encabezado, siempre cuadrada. El wrapper externo estira a la
 * altura de la fila (`self-stretch`, requiere padre flex `items-stretch`); la caja
 * interna toma esa altura con `h-full` y deriva el ancho con `aspect-square`. Se
 * anida así a propósito: `aspect-square` sobre un item flex directo no funciona
 * (el motor de flex ya resolvió su ancho antes del aspect-ratio → pastilla). En
 * uso aislado (sin fila que estire) pásale un tamaño por `className` (`size-10`).
 */
export function HeaderIcon({
  icon: Icon,
  variant = 'filled',
  tone = 'primary',
  className,
}: HeaderIconProps) {
  return (
    <div aria-hidden className={cn('flex shrink-0 self-stretch', className)}>
      <div
        className={cn(
          'flex aspect-square h-full min-h-9 items-center justify-center rounded-lg',
          HEADER_ICON_TONE_CLASS[variant][tone],
          variant === 'filled' && 'shadow-sm',
        )}
      >
        <Icon className="size-1/2 min-h-4 min-w-4 max-h-6 max-w-6" />
      </div>
    </div>
  );
}
