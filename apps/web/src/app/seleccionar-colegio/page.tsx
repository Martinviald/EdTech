import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import { auth } from '@/auth';
import { OrgSelector } from './OrgSelector';

export const dynamic = 'force-dynamic';

/**
 * Landing post-login. Actúa como resolver:
 *  - sin sesión → /login
 *  - platform_admin sin colegio → /admin
 *  - usuario con una sola org (o pending) → /dashboard directo (sin fricción)
 *  - usuario multi-org → muestra el selector de colegio
 *
 * Vive fuera del grupo (dashboard) a propósito: no debe heredar el guard que
 * exige orgId, para no entrar en bucle de redirección.
 */
export default async function SelectOrgPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.isPlatformAdmin && !session.user.orgId) redirect('/admin' as Route);
  if (session.user.orgs.length <= 1) redirect('/dashboard');

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
        <header className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold text-foreground">Selecciona tu colegio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu cuenta tiene acceso a más de una organización. Elige con cuál quieres entrar.
          </p>
        </header>

        <OrgSelector orgs={session.user.orgs} />
      </div>
    </main>
  );
}
