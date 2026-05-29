import { cn } from '@/lib/utils';

/**
 * Wrapper de página que estandariza el ritmo vertical entre el header y el
 * contenido. Reemplaza el `space-y-6` ad-hoc repetido en cada vista.
 */
export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('space-y-6', className)}>{children}</div>;
}
