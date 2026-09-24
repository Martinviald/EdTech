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
  /** Sobrescribe el tamaño por defecto (`size-10`) u otros estilos de la caja. */
  className?: string;
}

/**
 * Cajita de ícono de encabezado, siempre cuadrada y de tamaño FIJO (`size-10`
 * salvo override por `className`). El ícono ocupa la mitad de la caja.
 *
 * ⚠️ No volver al patrón anterior (wrapper `self-stretch` + caja interna
 * `aspect-square h-full`) para que el ícono creciera con el alto de la fila: ese
 * sizing es circular y el navegador lo resuelve en dos pasadas que no concuerdan.
 * En la pasada de ancho la altura del wrapper todavía es indefinida, así que
 * `h-full` cae a `auto` y el wrapper queda fijado en ~36px; recién después
 * `self-stretch` lo estira, `h-full` resuelve al alto real de la fila y
 * `aspect-square` recalcula un ancho mayor que ya no cabe. La caja desbordaba a
 * su wrapper, se comía el `gap` de la fila y se solapaba con el título — y tanto
 * más cuanto más alto el encabezado.
 */
export function HeaderIcon({
  icon: Icon,
  variant = 'filled',
  tone = 'primary',
  className,
}: HeaderIconProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg',
        HEADER_ICON_TONE_CLASS[variant][tone],
        variant === 'filled' && 'shadow-sm',
        className,
      )}
    >
      <Icon className="size-1/2" />
    </div>
  );
}
