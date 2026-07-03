'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { cn } from '@/lib/utils';

/**
 * Sub-navegación del hub de evaluación. Conserva la querystring (curso/filtros)
 * al cambiar de pestaña — mismo patrón que `ResultadosNav` — para no perder el
 * contexto de la vista (H6.2). Las pestañas visibles se calculan en el layout
 * (server) según los roles del usuario; aquí solo se renderizan.
 */
export type HubTab = { href: string; label: string; exact?: boolean };

export function AssessmentTabsNav({ tabs }: { tabs: HubTab[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : '';

  return (
    <nav className="flex flex-nowrap gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${suffix}` as Route}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
