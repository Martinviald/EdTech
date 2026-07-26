import { cn } from '@/lib/utils';

/**
 * Fila de acciones de la vista (crear, importar, exportar, preguntar a la IA…),
 * alineada a la derecha. Reemplaza al slot `actions` del antiguo encabezado de
 * página: desde que el título vive en la barra superior, las acciones son lo
 * único que queda del encabezado y no justifican un bloque completo.
 */
export function PageActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-3', className)}>{children}</div>
  );
}
