import { FolderOpen } from 'lucide-react';
import { auth } from '@/auth';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROLE_LABELS } from '@/components/layout/nav-items';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  // El shell ya verificó la sesión; este narrowing es solo para TypeScript.
  if (!session?.user) return null;

  const { user } = session;
  const roleLabel = ROLE_LABELS[user.role] ?? user.role;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Bienvenido, {user.name}</h1>
        <p className="text-sm text-muted-foreground">
          {roleLabel} · Pronto verás aquí el resumen de tus evaluaciones DIA.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Tu sesión</CardTitle>
          <CardDescription>Información del usuario autenticado.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
              <dd className="mt-1">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rol</dt>
              <dd className="mt-1">{roleLabel}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organización</dt>
              <dd className="mt-1 font-mono text-xs">{user.orgId}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <EmptyState
        title="Aún no tienes evaluaciones procesadas"
        description="Cuando importes hojas de respuesta DIA, los resultados aparecerán aquí."
        icon={FolderOpen}
      />
    </div>
  );
}
