'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sub-navegación del hub de evaluación. Conserva la querystring (curso/filtros)
 * al cambiar de pestaña — mismo patrón que `ResultadosNav` — para no perder el
 * contexto de la vista (H6.2). Las pestañas visibles se calculan en el layout
 * (server) según los roles del usuario; aquí solo se renderizan.
 *
 * Queda fija (`sticky`) al hacer scroll: el contenedor de scroll es el `<main>`
 * del dashboard (con `p-6`), así que se ancla a su borde superior. El `-mx-6 px-6`
 * la sangra hasta cubrir el padding horizontal del `main` (borde inferior a todo
 * el ancho) y el fondo opaco + `z-20` evitan que el contenido se transparente por
 * detrás.
 *
 * `-top-6` cancela el `pt-6` (24px) del `<main>`: sin él la barra se pegaría 24px
 * por debajo del navbar dejando un hueco vacío. Con él queda al ras del navbar
 * (`h-14`), de modo que lo único que queda por sobre las tabs al fijarse es el
 * propio navbar. Mantener sincronizado con el padding vertical del `<main>`.
 */
export type HubTab = {
  href: string;
  label: string;
  exact?: boolean;
  /**
   * La pestaña existe para el rol pero su contenido no aplica al dato de esta
   * evaluación (ver `capabilities` en la meta del informe). Se renderiza apagada
   * y sin enlace en vez de ocultarse: la forma del hub no cambia de una
   * evaluación a otra y el usuario no queda buscando una pestaña que "desapareció".
   */
  disabled?: boolean;
  /** Motivo de la deshabilitación, tal como lo manda el backend. Obligatorio si `disabled`. */
  disabledReason?: string;
};

export function AssessmentTabsNav({ tabs }: { tabs: HubTab[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : '';

  return (
    <nav className="sticky -top-6 z-20 -mx-6 flex flex-nowrap gap-1 overflow-x-auto border-b bg-background px-6">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

        if (tab.disabled) {
          return (
            <span
              key={tab.href}
              aria-disabled
              title={tab.disabledReason}
              className="flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground/60"
            >
              {tab.label}
              <Info className="size-3.5" aria-hidden />
              <span className="sr-only">{tab.disabledReason}</span>
            </span>
          );
        }

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
