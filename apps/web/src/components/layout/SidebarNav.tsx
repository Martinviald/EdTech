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
import { visibleNavItems, type NavItem } from './nav-items';

interface SidebarNavProps {
  role: UserRole;
  collapsed?: boolean;
  onNavigate?: () => void;
  onToggle?: () => void;
}

export function SidebarNav({
  role,
  collapsed = false,
  onNavigate,
  onToggle,
}: SidebarNavProps) {
  const pathname = usePathname();
  const items = visibleNavItems(role);

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <div className="flex h-full flex-col">
        <div
          className={cn(
            'flex h-14 shrink-0 items-center gap-2 border-b',
            collapsed ? 'justify-center px-2' : 'px-4',
          )}
        >
          <GraduationCap className="size-6 shrink-0 text-primary" aria-hidden />
          {!collapsed ? (
            <span className="text-sm font-semibold tracking-tight">SOE</span>
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
              isActive={isActive(pathname, item.href)}
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

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
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
