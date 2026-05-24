import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getCurrentOrg } from '@/lib/getCurrentOrg';
import { Sidebar } from '@/components/layout/Sidebar';
import { SkipLink } from '@/components/layout/SkipLink';
import { Topbar } from '@/components/layout/Topbar';
import { Toaster } from '@/components/ui/sonner';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

  const org = await getCurrentOrg(session.user.orgId);

  return (
    <div className="flex h-screen bg-background">
      <SkipLink />
      <Sidebar role={session.user.role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar org={org} user={session.user} role={session.user.role} />
        <main id="main-content" className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
