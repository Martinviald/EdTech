import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/auth';
import { canAccess, GRADING_SCALE_ROLES, userHasRole } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EscalaForm } from '../components/escala-form';

export default async function NuevaEscalaPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');
  if (!canAccess(session.user.roles, GRADING_SCALE_ROLES)) {
    redirect('/dashboard');
  }

  const canManageGlobal = userHasRole(session.user.roles, 'platform_admin');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={'/configuracion/escalas' as Route}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Volver a escalas
        </Link>
        <h1 className="text-2xl font-semibold">Nueva escala de notas</h1>
        <p className="text-muted-foreground text-sm">
          Configura el tipo de escala, su rango y el umbral de aprobación. Podrás previsualizar las
          conversiones desde el detalle una vez creada.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
        </CardHeader>
        <CardContent>
          <EscalaForm mode="create" canManageGlobal={canManageGlobal} />
        </CardContent>
      </Card>
    </div>
  );
}
