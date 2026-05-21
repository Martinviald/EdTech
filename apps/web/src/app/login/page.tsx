import { listActiveMembershipsForMock } from '@soe/db';
import { db } from '@/lib/db';
import { LoginButtons } from './LoginButtons';
import { MockLoginForm } from './MockLoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const isMock = process.env.AUTH_MODE === 'mock';

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
        <header className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-foreground">Sistema Operativo Educativo</h1>
          <p className="mt-1 text-sm text-foreground/60">Ingresa con tu cuenta institucional</p>
        </header>

        {isMock ? <MockSection /> : <LoginButtons />}
      </div>
    </main>
  );
}

async function MockSection() {
  const rows = await listActiveMembershipsForMock(db);
  const users = rows.map((r) => ({
    email: r.user.email,
    name: r.user.name,
    role: r.membership.role,
    orgName: r.organization.name,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-yellow-400/40 bg-yellow-100/60 px-3 py-2 text-xs text-yellow-900">
        Mock Auth activo — solo para desarrollo. Define <code>AUTH_MODE=sso</code> para usar SSO
        real.
      </div>
      {users.length === 0 ? (
        <p className="text-sm text-foreground/60">
          No hay usuarios de prueba. Corre <code>pnpm --filter @soe/db db:seed</code>.
        </p>
      ) : (
        <MockLoginForm users={users} />
      )}
    </div>
  );
}
