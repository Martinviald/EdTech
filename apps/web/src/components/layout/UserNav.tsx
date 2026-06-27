'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeftRight, ChevronDown, LogOut, Settings } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import type { UserRole } from '@soe/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROLE_LABELS } from './nav-items';
import { RoleSwitcher } from './RoleSwitcher';

interface UserNavProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  roles: readonly UserRole[];
  activeRole: UserRole;
  orgName: string;
  /** Si está presente, muestra el acceso para alternar colegio ↔ panel de plataforma. */
  platformLink?: { href: string; label: string };
}

export function UserNav({ user, roles, activeRole, orgName, platformLink }: UserNavProps) {
  const role = activeRole;
  const name = user.name ?? user.email ?? 'Usuario';
  const initials = getInitials(name);

  async function handleSignOut() {
    toast.success('Sesión cerrada');
    await signOut({ callbackUrl: '/login' });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Abrir menú de usuario"
          className="flex h-auto items-center gap-2 px-2 py-1.5"
        >
          <Avatar className="size-8">
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight">{name}</span>
            <span className="block text-xs leading-tight text-muted-foreground">
              {ROLE_LABELS[role] ?? role}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-2">
          <p className="text-sm font-semibold">{name}</p>
          {user.email ? (
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {ROLE_LABELS[role] ?? role} · {orgName}
          </p>
        </div>
        <DropdownMenuSeparator />
        {platformLink ? (
          <>
            <DropdownMenuItem asChild>
              <Link href={platformLink.href as Route}>
                <ArrowLeftRight className="size-4" aria-hidden />
                {platformLink.label}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {roles.length > 1 ? (
          <>
            <RoleSwitcher roles={roles} activeRole={activeRole} />
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem disabled>
          <Settings className="size-4" aria-hidden />
          Configuración
          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Próx.
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handleSignOut}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" aria-hidden />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
