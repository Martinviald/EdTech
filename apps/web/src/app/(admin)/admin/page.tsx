import Link from 'next/link';
import { MessageSquarePlus, School, ShieldCheck } from 'lucide-react';
import type { FeedbackAdminListResponse } from '@soe/types';
import { apiGet } from '@/lib/api';
import { listOrgs, listPlatformAdmins } from '@/lib/adminApi';
import { ROUTES } from '@/lib/routes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function AdminLandingPage() {
  const [orgs, admins, feedback] = await Promise.all([
    listOrgs({ limit: 1 }),
    listPlatformAdmins(),
    // `limit: 1` sólo para leer el total: la landing no lista comentarios.
    apiGet<FeedbackAdminListResponse>('/feedback/admin?limit=1&status=new'),
  ]);

  return (
    <div className="space-y-6">
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

        <Link href={ROUTES.adminFeedback} className="group">
          <Card className="transition-colors group-hover:border-primary/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <MessageSquarePlus className="size-5 text-primary" />
                <CardTitle>Comentarios</CardTitle>
              </div>
              <CardDescription>
                {feedback.total === 0
                  ? 'Sin comentarios nuevos'
                  : `${feedback.total} ${feedback.total === 1 ? 'comentario nuevo' : 'comentarios nuevos'}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Lo que reportan las personas usuarias desde el widget in-app.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
