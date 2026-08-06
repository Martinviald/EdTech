'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { useRememberedHref } from '@/components/shared';
import { useResolvedPageTitle } from './page-title-context';

/**
 * Título de la vista dentro de la barra superior. Vive acá y no en el cuerpo de
 * la página: la barra ya ocupa una franja fija y estaba prácticamente vacía, así
 * que el contenido de la vista parte inmediatamente bajo ella.
 *
 * `parent` es el camino de vuelta al hub que contiene la vista (lo que antes
 * cada página pintaba como `breadcrumb`/`BackLink` sobre su título). Se pinta
 * con la flecha de volver: la etiqueta se oculta en pantallas angostas, pero la
 * flecha se mantiene siempre para no quedarse sin camino de regreso.
 *
 * Si el hub de destino es un listado filtrado, se vuelve CON sus filtros: los
 * recuerda `list-search-memory` (la querystring no viaja en `parent.href`).
 */
export function TopbarTitle() {
  const page = useResolvedPageTitle();
  const parentHref = useRememberedHref(page?.parent?.href);

  if (!page) return <div className="flex-1" />;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {page.parent ? (
        <>
          <Link
            href={(parentHref ?? page.parent.href) as Route}
            aria-label={`Volver a ${page.parent.label}`}
            className="flex max-w-[14rem] shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors duration-fast hover:text-foreground"
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            <span className="hidden truncate lg:block">{page.parent.label}</span>
          </Link>
          <span className="hidden shrink-0 text-sm text-muted-foreground lg:block" aria-hidden>
            /
          </span>
        </>
      ) : null}
      <h1 className="truncate text-base font-semibold tracking-tight">{page.title}</h1>
    </div>
  );
}
