import { cn } from '@/lib/utils';

/**
 * Barra de progreso indeterminada, fina, para el borde superior de un contenedor
 * `relative` (p. ej. la FilterBar). Indica que hay una carga en curso SIN quitar
 * el contenido previo (a diferencia de un skeleton). Nula cuando no está activa.
 */
export function TopProgressBar({
  active,
  position = 'top',
  className,
}: {
  active: boolean;
  position?: 'top' | 'bottom';
  className?: string;
}) {
  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-label="Cargando"
      className={cn(
        'pointer-events-none absolute inset-x-0 z-10 h-0.5 overflow-hidden bg-primary/15',
        position === 'top' ? 'top-0 rounded-t-xl' : 'bottom-0 rounded-b-xl',
        className,
      )}
    >
      <div className="h-full w-1/3 animate-progress-indeterminate rounded-full bg-primary" />
    </div>
  );
}
