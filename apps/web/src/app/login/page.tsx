import { redirect } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import { auth } from '@/auth';
import { internalGet } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { AlertCallout } from '@/components/patterns';
import { LoginButtons } from './LoginButtons';
import { MockLoginForm } from './MockLoginForm';

type MockUser = { email: string; name: string; role: string; orgName: string };

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Si el usuario ya está autenticado, no mostramos el login: lo enviamos al
  // resolver post-login, que decide el destino según org/rol (multi-org,
  // platform_admin o dashboard directo).
  const session = await auth();
  if (session?.user) redirect('/seleccionar-colegio');

  const isMock = process.env.AUTH_MODE === 'mock';

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
        <header className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold text-foreground">{BRAND.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{BRAND.legalName}</p>
          <p className="mt-3 text-sm text-muted-foreground">Ingresa con tu cuenta institucional</p>
        </header>

        {isMock ? <MockSection /> : <LoginButtons />}
      </div>
    </main>
  );
}

async function MockSection() {
  const users = await internalGet<MockUser[]>('/auth/mock-users');

  return (
    <div className="flex flex-col gap-4">
      <AlertCallout tone="warning">
        Mock Auth activo — solo para desarrollo. Define <code>AUTH_MODE=sso</code> para usar SSO
        real.
      </AlertCallout>
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
