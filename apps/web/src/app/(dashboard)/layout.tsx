import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { canAccess, ASSISTANT_USER_ROLES } from '@soe/types';
import { auth } from '@/auth';
import { getCurrentOrg } from '@/lib/getCurrentOrg';
import { isFeatureEnabled } from '@/lib/features';
import { Sidebar } from '@/components/layout/Sidebar';
import { SkipLink } from '@/components/layout/SkipLink';
import { Topbar } from '@/components/layout/Topbar';
import { Toaster } from '@/components/ui/sonner';
import { AssistantProvider, AssistantWidget } from '@/components/assistant';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.isPlatformAdmin && !session.user.orgId) redirect('/admin' as Route);
  if (!session.user.orgId) redirect('/login');

  const org = await getCurrentOrg(session.user.orgId);

  // Asistente embebido (E21): solo si el usuario tiene rol directivo Y la feature
  // de tier pago está habilitada. El gating real lo impone el backend; esto decide
  // si se monta el botón flotante + panel. El provider se monta SIEMPRE para que
  // las vistas puedan declarar su contexto sin saber si el asistente está activo.
  const assistantEnabled =
    canAccess(session.user.roles, ASSISTANT_USER_ROLES) && (await isFeatureEnabled('ai_assistant'));

  return (
    <AssistantProvider enabled={assistantEnabled}>
      <div className="flex h-screen bg-background">
        <SkipLink />
        <Sidebar roles={session.user.roles} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar
            org={org}
            user={session.user}
            roles={session.user.roles}
            activeRole={session.user.activeRole}
          />
          <main id="main-content" className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
        <Toaster position="top-right" richColors closeButton />
        {assistantEnabled && <AssistantWidget />}
      </div>
    </AssistantProvider>
  );
}
