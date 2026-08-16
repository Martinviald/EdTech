'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useRememberedHref } from './list-search-memory';

/**
 * Enlace de vuelta al listado que contiene la vista actual, restaurando los
 * filtros que ese listado tenía (ver `list-search-memory`). Para las vistas que
 * pintan su propio enlace de vuelta en el cuerpo; el de la barra superior lo
 * resuelve `TopbarTitle` con el mismo mecanismo.
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  const rememberedHref = useRememberedHref(href) ?? href;

  return (
    <Link
      href={rememberedHref as Route}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden />
      {label}
    </Link>
  );
}
