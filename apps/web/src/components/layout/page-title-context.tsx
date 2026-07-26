'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

import { resolvePageTitle, type PageTitle } from './page-titles';

/**
 * Título declarado por la vista actual, anclado al pathname que lo declaró: al
 * navegar, el título de la vista anterior deja de aplicar aunque su efecto de
 * limpieza todavía no haya corrido.
 */
type TitleOverride = PageTitle & { pathname: string };

interface PageTitleContextValue {
  override: TitleOverride | null;
  setOverride: (next: TitleOverride | null) => void;
  clearOverride: (pathname: string, title: string) => void;
}

const PageTitleCtx = createContext<PageTitleContextValue | null>(null);

/**
 * Estado del título de la vista, que la barra superior (`TopbarTitle`) pinta en
 * vez del cuerpo de la página. Se monta en el layout del dashboard y del panel
 * de plataforma, envolviendo tanto la barra como el contenido.
 *
 * El título por defecto sale de la ruta (`page-titles.ts`), así viaja en el HTML
 * del servidor. Este contexto sólo cubre a las vistas cuyo título depende de
 * datos (nombre de la evaluación, del instrumento, del curso…), que lo declaran
 * con `<SetPageTitle>`.
 */
export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverride] = useState<TitleOverride | null>(null);

  const clearOverride = useCallback((pathname: string, title: string) => {
    // Sólo limpia si el título vigente sigue siendo el nuestro: si otra vista ya
    // declaró el suyo, no lo pisamos al desmontar.
    setOverride((prev) => (prev?.pathname === pathname && prev.title === title ? null : prev));
  }, []);

  const value = useMemo(
    () => ({ override, setOverride, clearOverride }),
    [override, clearOverride],
  );

  return <PageTitleCtx.Provider value={value}>{children}</PageTitleCtx.Provider>;
}

/**
 * Título a mostrar para la ruta actual: el que declaró la vista si corresponde a
 * este pathname, y si no el del mapa de rutas. `null` si la ruta no tiene título.
 */
export function useResolvedPageTitle(): PageTitle | null {
  const pathname = usePathname();
  const ctx = useContext(PageTitleCtx);
  const fromRoute = resolvePageTitle(pathname);
  const override = ctx?.override;

  if (override && override.pathname === pathname) {
    // El `parent` del mapa vale como respaldo: casi ninguna vista necesita
    // redefinir su camino de vuelta, sólo su título.
    return { title: override.title, parent: override.parent ?? fromRoute?.parent };
  }

  return fromRoute;
}

/**
 * Declara el título de la vista actual cuando depende de datos (no se puede
 * saber sólo por la ruta). Pensado para usarse desde Server Components:
 * `<SetPageTitle title={assessment.name} />`. No renderiza nada; el título lo
 * pinta la barra superior.
 *
 * Si el título es fijo por ruta NO uses esto: agrégalo a `page-titles.ts`, así
 * viaja ya renderizado en el HTML del servidor.
 */
export function SetPageTitle({
  title,
  parentHref,
  parentLabel,
}: {
  title: string;
  /** Camino de vuelta, si difiere del que ya define el mapa de rutas. */
  parentHref?: string;
  parentLabel?: string;
}): null {
  const pathname = usePathname();
  const ctx = useContext(PageTitleCtx);
  const setOverride = ctx?.setOverride;
  const clearOverride = ctx?.clearOverride;

  useEffect(() => {
    if (!setOverride || !clearOverride) return;
    setOverride({
      pathname,
      title,
      parent: parentHref && parentLabel ? { href: parentHref, label: parentLabel } : undefined,
    });
    return () => clearOverride(pathname, title);
  }, [pathname, title, parentHref, parentLabel, setOverride, clearOverride]);

  return null;
}
