'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FocusEvent } from 'react';
import type { UserRole } from '@soe/types';
import { cn } from '@/lib/utils';
import { SidebarNav, type SidebarVariant } from './SidebarNav';

const STORAGE_KEY = 'soe:sidebar-collapsed';

interface SidebarProps {
  roles: readonly UserRole[];
  className?: string;
  variant?: SidebarVariant;
}

/**
 * Sidebar de escritorio. Hay dos estados distintos y sólo uno es preferencia:
 *
 * - `pinnedCollapsed`: la elección explícita del usuario con el botón. Es la
 *   única que persiste en localStorage.
 * - `hoverExpanded`: despliegue temporal mientras el puntero (o el foco) está
 *   sobre el panel. No escribe preferencia — al salir vuelve a lo fijado.
 *
 * Estando fijado colapsado, el despliegue por hover FLOTA sobre el contenido
 * (el ancho que reserva el `aside` no cambia) para no reacomodar la página cada
 * vez que el mouse pasa por encima.
 */
export function Sidebar({ roles, className, variant }: SidebarProps) {
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') setPinnedCollapsed(true);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, String(pinnedCollapsed));
  }, [pinnedCollapsed, hydrated]);

  const collapsed = pinnedCollapsed && !hoverExpanded;
  const floating = pinnedCollapsed && hoverExpanded;

  // El botón actúa sobre la PREFERENCIA (`pinnedCollapsed`), no sobre lo que se
  // ve en ese instante: para hacerle click hay que pasar el puntero por encima,
  // lo que ya desplegó el panel por hover. Si actuara sobre el estado visual,
  // estando fijado colapsado el click siempre volvería a colapsar y no habría
  // forma de fijarlo abierto con el mouse.
  // Limpiar `hoverExpanded` hace que el cambio se vea de inmediato, sin esperar
  // a que el puntero salga del panel.
  const toggle = useCallback(() => {
    setPinnedCollapsed((prev) => !prev);
    setHoverExpanded(false);
  }, []);

  const expandOnHover = useCallback(() => setHoverExpanded(true), []);
  const collapseOnLeave = useCallback(() => setHoverExpanded(false), []);

  // `onBlur` (focusout) también salta al mover el foco ENTRE items del sidebar:
  // sólo colapsa cuando el foco sale del panel completo.
  const collapseOnFocusLeave = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setHoverExpanded(false);
  }, []);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'relative hidden shrink-0 p-3 transition-[width] duration-base ease-out-soft md:block',
        pinnedCollapsed ? 'w-[4.75rem]' : 'w-64',
        className,
      )}
    >
      <div
        onMouseEnter={expandOnHover}
        onMouseLeave={collapseOnLeave}
        onFocus={expandOnHover}
        onBlur={collapseOnFocusLeave}
        className={cn(
          'absolute inset-y-3 left-3 flex flex-col rounded-2xl border bg-card transition-[width] duration-base ease-out-soft',
          collapsed ? 'w-[3.25rem]' : 'w-[14.5rem]',
          floating ? 'z-40 shadow-2xl' : 'shadow-lg',
        )}
      >
        <SidebarNav
          roles={roles}
          collapsed={collapsed}
          pinnedCollapsed={pinnedCollapsed}
          onToggle={toggle}
          variant={variant}
        />
      </div>
    </aside>
  );
}
