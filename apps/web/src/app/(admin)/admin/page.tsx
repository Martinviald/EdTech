import Link from 'next/link';
import { School, ShieldCheck } from 'lucide-react';
import { listOrgs, listPlatformAdmins } from '@/lib/adminApi';
import { ROUTES } from '@/lib/routes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function AdminLandingPage() {
  const [orgs, admins] = await Promise.all([
    listOrgs({ limit: 1 }),
    listPlatformAdmins(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Panel de plataforma</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona colegios, cuentas y operadores con permisos globales.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href={ROUTES.adminColegios} className="group">
          <Card className="transition-colors group-hover:border-primary/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <School className="size-5 text-primary" />
                <CardTitle>Colegios</CardTitle>
              </div>
              <CardDescription>{orgs.total} colegios registrados</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Crear nuevos, ver detalles, gestionar miembros y roles.
            </CardContent>
          </Card>
        </Link>

        <Link href={ROUTES.adminEquipo} className="group">
          <Card className="transition-colors group-hover:border-primary/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                <CardTitle>Equipo plataforma</CardTitle>
              </div>
              <CardDescription>{admins.length} administradores activos</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Agregar o revocar super admins.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
