import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { LogoutButton } from './LogoutButton';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login' as never);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">Bienvenido, {session.user.name}</h1>
        <dl className="mt-4 grid grid-cols-1 gap-2 text-sm text-foreground/80">
          <div className="flex justify-between">
            <dt className="font-medium">Email</dt>
            <dd>{session.user.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium">Org ID</dt>
            <dd className="font-mono text-xs">{session.user.orgId}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium">Role</dt>
            <dd>{session.user.role}</dd>
          </div>
        </dl>
        <div className="mt-6 flex justify-end">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
