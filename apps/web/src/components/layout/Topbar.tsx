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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
      <MobileSidebar roles={roles} />
      <span className="hidden text-sm font-medium text-muted-foreground md:block" title={org.name}>
        {org.name}
      </span>
      <div className="flex-1" />
      <ThemeToggle />
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
