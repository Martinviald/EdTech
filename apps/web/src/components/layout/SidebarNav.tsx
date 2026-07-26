'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { ChevronDown, ChevronLeft, ChevronRight, GraduationCap, LogOut } from 'lucide-react';
import type { UserRole } from '@soe/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { useOptimisticRoute } from '@/components/shared';
import { cn } from '@/lib/utils';
import { BRAND } from '@/lib/brand';
import { signOutToLogin } from '@/lib/sign-out';
import { ADMIN_NAV_ITEMS, visibleNavGroups, type NavItem } from './nav-items';

const GROUPS_STORAGE_KEY = 'soe:sidebar-groups-collapsed';

/** Clases compartidas por las filas del sidebar: items de navegación y pie. */
const ROW_BASE_CLASSES =
  'flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-colors duration-fast';
const ROW_FOCUS_CLASSES =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function rowSizeClasses(collapsed: boolean): string {
  return collapsed ? 'w-full justify-center py-2' : 'px-3 py-1.5';
}

/** Sección renderizable del sidebar. La variante 'admin' usa una sola sección sin título. */
type NavSection = { id: string; label?: string; items: readonly NavItem[] };

export type SidebarVariant = 'main' | 'admin';

interface SidebarNavProps {
  roles: readonly UserRole[];
  /** Estado VISUAL: incluye el despliegue temporal por hover. Define qué se renderiza. */
  collapsed?: boolean;
  /**
   * Estado FIJADO por el usuario. Es sobre lo que actúa el botón, así que define
   * su ícono y su etiqueta: estando fijado colapsado el botón ofrece "Expandir"
   * aunque el hover lo tenga desplegado en ese momento. Por defecto sigue a
   * `collapsed` (sin hover ambos coinciden).
   */
  pinnedCollapsed?: boolean;
  onNavigate?: () => void;
  onToggle?: () => void;
  /** Cambia el set de items renderizados. 'main' = navegación normal, 'admin' = panel plataforma. */
  variant?: SidebarVariant;
}

export function SidebarNav({
  roles,
  collapsed = false,
  pinnedCollapsed,
  onNavigate,
  onToggle,
  variant = 'main',
}: SidebarNavProps) {
  const toggleCollapsed = pinnedCollapsed ?? collapsed;
  // El path activo es optimista: al hacer click salta de inmediato al destino
  // (sin esperar el commit) — ver use-optimistic-route.ts y la rule 07.
  const { activePath, navigate } = useOptimisticRoute();

  // Colapso por sección (T2-08): persiste qué grupos están plegados para despejar
  // los accesos menos frecuentes. Solo aplica en el sidebar expandido.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const stored = window.localStorage.getItem(GROUPS_STORAGE_KEY);
    if (!stored) return;
    try {
      setCollapsedGroups(JSON.parse(stored) as Record<string, boolean>);
    } catch {
      setCollapsedGroups({});
    }
  }, []);
  const toggleGroup = useCallback((id: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const sections: NavSection[] =
    variant === 'admin' ? [{ id: 'admin', items: ADMIN_NAV_ITEMS }] : visibleNavGroups(roles);
  const activeHref = findActiveHref(
    activePath,
    sections.flatMap((s) => s.items),
  );

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <div className="relative flex h-full flex-col">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={toggleCollapsed ? 'Expandir menú' : 'Colapsar menú'}
            aria-expanded={!toggleCollapsed}
            className="absolute -right-3 top-5 z-10 flex size-6 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {toggleCollapsed ? (
              <ChevronRight className="size-3.5" aria-hidden />
            ) : (
              <ChevronLeft className="size-3.5" aria-hidden />
            )}
          </button>
        ) : null}

        <div
          className={cn(
            'flex h-14 shrink-0 items-center gap-2 border-b',
            collapsed ? 'justify-center px-2' : 'px-4',
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          {!collapsed ? (
            <span className="text-base font-semibold tracking-tight">{BRAND.name}</span>
          ) : null}
        </div>

        <nav
          aria-label="Navegación principal"
          className={cn('scrollbar-none flex-1 overflow-y-auto', collapsed ? 'p-2' : 'p-3')}
        >
          {sections.map((section, idx) => {
            const groupCollapsed =
              !collapsed && Boolean(section.label) && Boolean(collapsedGroups[section.id]);
            return (
              <div
                key={section.id}
                className={cn(
                  'space-y-0.5',
                  idx > 0 && (collapsed ? 'mt-2 border-t pt-2' : 'mt-3'),
                )}
              >
                {!collapsed && section.label ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(section.id)}
                    aria-expanded={!groupCollapsed}
                    className="flex w-full items-center justify-between rounded px-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>{section.label}</span>
                    <ChevronDown
                      className={cn(
                        'size-3.5 transition-transform',
                        groupCollapsed && '-rotate-90',
                      )}
                      aria-hidden
                    />
                  </button>
                ) : null}
                {!groupCollapsed
                  ? section.items.map((item) => (
                      <NavRow
                        key={item.href}
                        item={item}
                        isActive={item.href === activeHref}
                        collapsed={collapsed}
                        activePath={activePath}
                        navigate={navigate}
                        onNavigate={onNavigate}
                      />
                    ))
                  : null}
              </div>
            );
          })}
        </nav>

        <div className={cn('shrink-0 border-t', collapsed ? 'p-2' : 'p-3')}>
          <SignOutRow collapsed={collapsed} />
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Cierre de sesión al pie del sidebar. Mismo destino que el menú de usuario de la topbar. */
function SignOutRow({ collapsed }: { collapsed: boolean }) {
  const button = (
    <button
      type="button"
      onClick={() => void signOutToLogin()}
      aria-label={collapsed ? 'Cerrar sesión' : undefined}
      className={cn(
        ROW_BASE_CLASSES,
        ROW_FOCUS_CLASSES,
        rowSizeClasses(collapsed),
        !collapsed && 'w-full',
        'text-foreground/70 hover:bg-destructive/10 hover:text-destructive',
      )}
    >
      <LogOut className="size-4 shrink-0" aria-hidden />
      {!collapsed ? <span>Cerrar sesión</span> : null}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">Cerrar sesión</TooltipContent>
    </Tooltip>
  );
}

/**
 * Devuelve el href del item con el match más específico respecto al pathname.
 *
 * Un item matchea si su href —o alguna de sus `matchPaths`— es igual al
 * pathname o es un prefijo de carpeta (pathname.startsWith(path + '/')). Cuando
 * varios items matchean (e.g. /admin y /admin/colegios cuando estás en
 * /admin/colegios), gana la ruta que matcheó más larga — así sólo el item más
 * específico queda marcado como activo.
 */
function findActiveHref(pathname: string | null, items: readonly NavItem[]): string | null {
  if (!pathname) return null;
  let best: { href: string; matchedLength: number } | null = null;
  for (const item of items) {
    for (const path of [item.href, ...(item.matchPaths ?? [])]) {
      const matches = pathname === path || pathname.startsWith(`${path}/`);
      if (!matches) continue;
      if (!best || path.length > best.matchedLength) {
        best = { href: item.href, matchedLength: path.length };
      }
    }
  }
  return best?.href ?? null;
}

interface NavRowProps {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  activePath: string | null;
  navigate: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  onNavigate?: () => void;
}

function NavRow({ item, isActive, collapsed, activePath, navigate, onNavigate }: NavRowProps) {
  const Icon = item.icon;
  const baseClasses = ROW_BASE_CLASSES;
  const focusClasses = ROW_FOCUS_CLASSES;
  const sizeClasses = rowSizeClasses(collapsed);

  if (item.status === 'soon') {
    const content = (
      <span
        aria-disabled="true"
        className={cn(baseClasses, sizeClasses, 'cursor-not-allowed text-muted-foreground/60')}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {!collapsed ? (
          <>
            <span>{item.label}</span>
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Próx.
            </span>
          </>
        ) : null}
      </span>
    );

    if (!collapsed) return content;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">
          {item.label}
          <span className="ml-2 text-muted-foreground">(Próx.)</span>
        </TooltipContent>
      </Tooltip>
    );
  }

  const targetHref = item.children?.[0]?.href ?? item.href;
  const link = (
    <Link
      href={targetHref as Route}
      aria-current={isActive ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      onClick={(event) => {
        navigate(event, targetHref);
        onNavigate?.();
      }}
      className={cn(
        baseClasses,
        focusClasses,
        sizeClasses,
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-foreground/70 hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {!collapsed ? <span>{item.label}</span> : null}
    </Link>
  );

  if (!collapsed) return link;

  if (item.children && item.children.length > 0) {
    return (
      <HoverCard openDelay={100} closeDelay={100}>
        <HoverCardTrigger asChild>{link}</HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="w-56 p-0">
          <p className="border-b px-3 py-2 text-sm font-semibold">{item.label}</p>
          <div className="p-1">
            {item.children.map((child) => {
              const childActive = activePath === child.href;
              return (
                <Link
                  key={child.href}
                  href={child.href as Route}
                  aria-current={childActive ? 'page' : undefined}
                  onClick={(event) => {
                    navigate(event, child.href);
                    onNavigate?.();
                  }}
                  className={cn(
                    'block rounded-md px-3 py-1.5 text-sm transition-colors duration-fast',
                    childActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground/80 hover:bg-muted hover:text-foreground',
                  )}
                >
                  {child.label}
                </Link>
              );
            })}
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
