'use client';

import type { Route } from 'next';
import Link from 'next/link';

import { useResolvedPageTitle } from './page-title-context';

/**
 * Título de la vista dentro de la barra superior. Vive acá y no en el cuerpo de
 * la página: la barra ya ocupa una franja fija y estaba prácticamente vacía, así
 * que el contenido de la vista parte inmediatamente bajo ella.
 *
 * `parent` es el camino de vuelta al hub que contiene la vista (lo que antes
 * cada página pintaba como `breadcrumb`/`BackLink` sobre su título).
 */
export function TopbarTitle() {
  const page = useResolvedPageTitle();

  if (!page) return <div className="flex-1" />;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {page.parent ? (
        <>
          <Link
            href={page.parent.href as Route}
            className="hidden max-w-[14rem] shrink-0 truncate text-sm text-muted-foreground transition-colors duration-fast hover:text-foreground lg:block"
          >
            {page.parent.label}
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
