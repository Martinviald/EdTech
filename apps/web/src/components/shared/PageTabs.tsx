'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Route } from 'next';

import { cn } from '@/lib/utils';
import { TopProgressBar } from './TopProgressBar';
import { useOptimisticRoute } from './use-optimistic-route';

export type PageTab = {
  href: string;
  label: string;
  /**
   * Icono opcional a la izquierda de la etiqueta. Pasar un elemento renderizado
   * (`icon: <Building2 />`), no la referencia al componente — así funciona al
   * pasar las tabs desde un Server Component al `PageTabs` (client).
   */
  icon?: ReactNode;
  /** Contador opcional junto a la etiqueta (p. ej. "Tokens 4"). */
  count?: number;
  /** Activa solo con match exacto de ruta; por defecto también hace match de subrutas. */
  exact?: boolean;
};

interface PageTabsProps {
  tabs: readonly PageTab[];
  /**
   * Fija la barra al hacer scroll, anclada al `<main>` del dashboard (`p-6`).
   * Queda por debajo del Topbar (`z-30`).
   */
  sticky?: boolean;
  className?: string;
}

/**
 * Sub-navegación de sección por pestañas. Preserva la querystring (filtros /
 * curso) al cambiar de pestaña. Unifica el patrón que antes se reescribía en
 * `ResultadosNav` y `AssessmentTabsNav`.
 */
export function PageTabs({ tabs, sticky = false, className }: PageTabsProps) {
  // Tab activa optimista: se marca al click, no al commit (ver rule 07).
  const { activePath, isPending, navigate } = useOptimisticRoute();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : '';

  return (
    <nav
      className={cn(
        'relative flex gap-1 border-b',
        sticky
          ? 'sticky -top-6 z-20 -mx-6 flex-nowrap overflow-x-auto bg-background px-6'
          : 'flex-wrap',
        className,
      )}
    >
      <TopProgressBar active={isPending} position="bottom" className="rounded-none" />
      {tabs.map((tab) => {
        const active = tab.exact
          ? activePath === tab.href
          : activePath === tab.href || activePath.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${suffix}` as Route}
            onClick={(event) => navigate(event, `${tab.href}${suffix}`)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-fast [&_svg]:size-4 [&_svg]:shrink-0',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === 'number' ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
