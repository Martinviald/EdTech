import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { SkipLink } from '@/components/layout/SkipLink';
import { Toaster } from '@/components/ui/sonner';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!session.user.isPlatformAdmin) redirect('/dashboard');

  const orgPlaceholder = {
    id: '00000000-0000-0000-0000-000000000000',
    name: 'Plataforma SOE',
    type: 'platform' as const,
  };

  return (
    <div className="flex h-screen bg-background">
      <SkipLink />
      <Sidebar roles={['platform_admin']} variant="admin" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          org={orgPlaceholder}
          user={session.user}
          roles={session.user.roles}
          activeRole={session.user.activeRole}
        />
        <main id="main-content" className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
