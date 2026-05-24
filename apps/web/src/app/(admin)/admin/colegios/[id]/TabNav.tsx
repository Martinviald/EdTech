'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

type Tab = { href: string; label: string };

export function TabNav({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const base = `/admin/colegios/${orgId}`;

  const tabs: Tab[] = [
    { href: base, label: 'Perfil' },
    { href: `${base}/miembros`, label: 'Miembros' },
    { href: `${base}/asignaturas`, label: 'Asignaturas' },
    { href: `${base}/cursos`, label: 'Cursos' },
  ];

  return (
    <nav className="border-b" aria-label="Secciones del colegio">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active =
            tab.href === base
              ? pathname === base
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href as Route}
                className={cn(
                  'inline-block border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
