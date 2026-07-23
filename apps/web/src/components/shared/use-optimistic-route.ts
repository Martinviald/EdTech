'use client';

import { useCallback, useOptimistic, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Route } from 'next';

/**
 * Navegación con feedback inmediato (rule 07 · react-best-practices §5.6).
 *
 * `usePathname()` solo cambia cuando la navegación CONMUTA, así que un highlight
 * activo basado en él deja la UI muda entre el click y el commit. Este hook
 * expone `activePath` optimista: al hacer click el path salta de inmediato al
 * destino (y revierte solo si la navegación falla), e `isPending` alimenta una
 * barra de progreso mientras llega el RSC payload.
 *
 * Uso: mantener el `<Link href=...>` normal (prefetch, cmd+click y middle-click
 * siguen funcionando) y sumarle `onClick={(e) => navigate(e, href)}`. Los clicks
 * con modificador (nueva pestaña) se dejan pasar al comportamiento nativo.
 */
export function useOptimisticRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const [activePath, setOptimisticPath] = useOptimistic(pathname);
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      startTransition(() => {
        setOptimisticPath(stripQuery(href));
        router.push(href as Route);
      });
    },
    [router, setOptimisticPath],
  );

  return { activePath, isPending, navigate };
}

function stripQuery(href: string): string {
  const [path] = href.split('?');
  return path ?? href;
}
