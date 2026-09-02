'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { FeedbackContext } from '@soe/types';
import { useResolvedPageTitle } from '@/components/layout/page-title-context';

/**
 * Arma el contexto que viaja junto al comentario. Nada de esto se le pide a la
 * persona: es exactamente la diferencia entre "no me funcionó" y un ticket que
 * alguien puede reproducir.
 *
 * Es best-effort por diseño — si algo falla al leerse, se omite el campo y el
 * comentario se envía igual. Perder el contexto es molesto; perder el comentario
 * es inaceptable.
 */
export function useFeedbackContext(): () => FeedbackContext {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageTitle = useResolvedPageTitle();

  return useCallback((): FeedbackContext => {
    const query = searchParams?.toString();
    const context: FeedbackContext = {
      path: query ? `${pathname}?${query}` : pathname,
      clientTime: new Date().toISOString(),
    };

    if (pageTitle?.title) context.pageTitle = pageTitle.title.slice(0, 200);
    if (typeof navigator !== 'undefined') {
      context.userAgent = navigator.userAgent.slice(0, 512);
    }
    if (typeof window !== 'undefined') {
      context.viewport = { width: window.innerWidth, height: window.innerHeight };
    }
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    if (appVersion) context.appVersion = appVersion.slice(0, 64);

    return context;
  }, [pathname, searchParams, pageTitle]);
}
