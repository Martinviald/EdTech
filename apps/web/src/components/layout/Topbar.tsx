import { Building2 } from 'lucide-react';
import type { UserRole } from '@soe/types';
import { MobileSidebar } from './MobileSidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserNav } from './UserNav';

interface TopbarProps {
  org: { id: string; name: string };
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  roles: readonly UserRole[];
  activeRole: UserRole;
  /** Orgs del usuario para el selector multi-org (colegio). */
  orgs?: readonly { id: string; name: string }[];
  /** Acceso para platform_admin a alternar entre su colegio y el panel de plataforma. */
  platformLink?: { href: string; label: string };
}

export function Topbar({ org, user, roles, activeRole, orgs = [], platformLink }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 rounded-b-2xl border-x border-b border-border/60 bg-card/80 px-4 backdrop-blur-md md:px-6">
      <MobileSidebar roles={roles} />
      {org.name ? (
        <span
          className="hidden items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm font-medium text-muted-foreground md:inline-flex"
          title={org.name}
        >
          <Building2 className="size-4 shrink-0" aria-hidden />
          {org.name}
        </span>
      ) : null}
      <div className="flex-1" />
      <ThemeToggle />
      <div className="mx-1 hidden h-6 w-px bg-border md:block" aria-hidden />
      <UserNav
        user={user}
        roles={roles}
        activeRole={activeRole}
        orgName={org.name}
        orgs={orgs}
        activeOrgId={org.id}
        platformLink={platformLink}
      />
    </header>
  );
}
