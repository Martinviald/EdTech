'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useTelemetry } from './telemetry-provider';

/**
 * Emite un evento `page.viewed` en cada cambio de ruta. `section` es el primer
 * segmento del path (p. ej. `/resultados/mapa-calor` → `resultados`), para
 * agrupar el uso por módulo sin depender de la lista concreta de rutas.
 */
export function useTrackPageView(): void {
  const pathname = usePathname();
  const { track } = useTelemetry();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    lastPath.current = pathname;
    track('page.viewed', { path: pathname, section: sectionOf(pathname) });
  }, [pathname, track]);
}

function sectionOf(pathname: string): string | undefined {
  const segment = pathname.split('/').find((part) => part.length > 0);
  return segment ?? undefined;
}
