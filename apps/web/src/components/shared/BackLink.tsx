import type { Route } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/**
 * Enlace de vuelta al hub que contiene la vista. Va en el slot `breadcrumb` de
 * `PageHeader`: es el único camino de regreso cuando la vista no tiene un item
 * propio en el sidebar (p. ej. las vistas de `/administracion`).
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href as Route}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors duration-fast hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
