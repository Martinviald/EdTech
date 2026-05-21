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
  role: UserRole;
}

export function Topbar({ org, user, role }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
      <MobileSidebar role={role} />
      <span className="hidden text-sm font-medium text-muted-foreground md:block" title={org.name}>
        {org.name}
      </span>
      <div className="flex-1" />
      <ThemeToggle />
      <UserNav user={user} role={role} orgName={org.name} />
    </header>
  );
}
