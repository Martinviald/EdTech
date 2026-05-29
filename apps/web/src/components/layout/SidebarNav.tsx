'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GraduationCap, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { UserRole } from '@soe/types';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { BRAND } from '@/lib/brand';
import { ADMIN_NAV_ITEMS, visibleNavItems, type NavItem } from './nav-items';

export type SidebarVariant = 'main' | 'admin';

interface SidebarNavProps {
  roles: readonly UserRole[];
  collapsed?: boolean;
  onNavigate?: () => void;
  onToggle?: () => void;
  /** Cambia el set de items renderizados. 'main' = navegación normal, 'admin' = panel plataforma. */
  variant?: SidebarVariant;
}

export function SidebarNav({
  roles,
  collapsed = false,
  onNavigate,
  onToggle,
  variant = 'main',
}: SidebarNavProps) {
  const pathname = usePathname();
  const items: readonly NavItem[] =
    variant === 'admin' ? ADMIN_NAV_ITEMS : visibleNavItems(roles);
  const activeHref = findActiveHref(pathname, items);

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <div className="flex h-full flex-col">
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
          className={cn('flex-1 space-y-1 overflow-y-auto', collapsed ? 'p-2' : 'p-3')}
        >
          {items.map((item) => (
            <NavRow
              key={item.href}
              item={item}
              isActive={item.href === activeHref}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
        {onToggle ? (
          <div className="shrink-0 border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
              aria-expanded={!collapsed}
              className={cn(
                'w-full gap-2 text-muted-foreground',
                collapsed ? 'justify-center px-0' : 'justify-start',
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" aria-hidden />
              ) : (
                <PanelLeftClose className="size-4" aria-hidden />
              )}
              {!collapsed ? <span>Colapsar</span> : null}
            </Button>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

/**
 * Devuelve el href del item con el match más específico respecto al pathname.
 *
 * Un item matchea si su href es igual al pathname o si es un prefijo de carpeta
 * (pathname.startsWith(href + '/')). Cuando varios items matchean (e.g. /admin
 * y /admin/colegios cuando estás en /admin/colegios), gana el href más largo —
 * así sólo el item más específico queda marcado como activo.
 */
function findActiveHref(
  pathname: string | null,
  items: readonly NavItem[],
): string | null {
  if (!pathname) return null;
  let best: NavItem | null = null;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) continue;
    if (!best || item.href.length > best.href.length) {
      best = item;
    }
  }
  return best?.href ?? null;
}

interface NavRowProps {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}

function NavRow({ item, isActive, collapsed, onNavigate }: NavRowProps) {
  const Icon = item.icon;
  const baseClasses =
    'flex items-center gap-3 rounded-md text-sm font-medium transition-colors';
  const focusClasses =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  const sizeClasses = collapsed ? 'h-10 w-10 justify-center' : 'px-3 py-2';

  if (item.status === 'soon') {
    const content = (
      <span
        aria-disabled="true"
        className={cn(
          baseClasses,
          sizeClasses,
          'cursor-not-allowed text-muted-foreground/70 opacity-70',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {!collapsed ? (
          <>
            <span>{item.label}</span>
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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

  const link = (
    <Link
      href={item.href as Route}
      aria-current={isActive ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={cn(
        baseClasses,
        focusClasses,
        sizeClasses,
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {!collapsed ? <span>{item.label}</span> : null}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
