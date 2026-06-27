'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { cn } from '@/lib/utils';

/**
 * Sub-navegación de la sección Resultados. Mantiene la querystring (filtros)
 * al cambiar de vista para que los filtros aplicados se conserven (H6.2).
 */
const TABS: { href: string; label: string }[] = [
  { href: '/resultados', label: 'Resumen' },
  { href: '/resultados/informe', label: 'Informe' },
  { href: '/resultados/clasificacion', label: 'Clasificación' },
  { href: '/resultados/habilidades', label: 'Habilidades' },
  { href: '/resultados/mapa-calor', label: 'Mapa de calor' },
  { href: '/resultados/detalle', label: 'Detalle por pregunta' },
  { href: '/resultados/comparacion', label: 'Comparación' },
  { href: '/resultados/progresion', label: 'Progresión' },
  // Salto contextual a Análisis IA conservando la evaluación + filtros activos
  // (la querystring se arrastra). Vive fuera de /resultados pero es la
  // continuación natural del informe de una evaluación (E20).
  { href: '/analisis-ia', label: 'Análisis IA' },
];

export function ResultadosNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const suffix = qs ? `?${qs}` : '';

  return (
    <nav className="flex flex-wrap gap-1 border-b">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${suffix}` as Route}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
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
