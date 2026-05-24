'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserRole } from '@soe/types';
import { cn } from '@/lib/utils';
import { SidebarNav, type SidebarVariant } from './SidebarNav';

const STORAGE_KEY = 'soe:sidebar-collapsed';

interface SidebarProps {
  role: UserRole;
  className?: string;
  variant?: SidebarVariant;
}

export function Sidebar({ role, className, variant }: SidebarProps) {
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
        'hidden shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-out md:flex',
        collapsed ? 'w-16' : 'w-64',
        className,
      )}
    >
      <SidebarNav role={role} collapsed={collapsed} onToggle={toggle} variant={variant} />
    </aside>
  );
}
