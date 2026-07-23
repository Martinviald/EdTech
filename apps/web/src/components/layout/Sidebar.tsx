'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserRole } from '@soe/types';
import { cn } from '@/lib/utils';
import { SidebarNav, type SidebarVariant } from './SidebarNav';

const STORAGE_KEY = 'soe:sidebar-collapsed';

interface SidebarProps {
  roles: readonly UserRole[];
  className?: string;
  variant?: SidebarVariant;
}

export function Sidebar({ roles, className, variant }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') setCollapsed(true);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed, hydrated]);

  const toggle = useCallback(() => setCollapsed((prev) => !prev), []);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'relative hidden shrink-0 p-3 transition-[width] duration-base ease-out-soft md:block',
        collapsed ? 'w-[4.75rem]' : 'w-64',
        className,
      )}
    >
      <div className="flex h-full flex-col rounded-2xl border bg-card shadow-lg">
        <SidebarNav roles={roles} collapsed={collapsed} onToggle={toggle} variant={variant} />
      </div>
    </aside>
  );
}
