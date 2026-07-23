import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { canAccess, GRADING_SCALE_ROLES, userHasRole } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer, PageHeader } from '@/components/shared';
import { EscalaForm } from '../components/escala-form';

export default async function NuevaEscalaPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, GRADING_SCALE_ROLES)) {
    redirect(ROUTES.dashboard);
  }

  const canManageGlobal = userHasRole(session.user.roles, 'platform_admin');

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={
          <Link
            href={ROUTES.configEscalas}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ChevronLeft className="size-4" /> Volver a escalas
          </Link>
        }
        title="Nueva escala de notas"
        description="Configura el tipo de escala, su rango y el umbral de aprobación. Podrás previsualizar las conversiones desde el detalle una vez creada."
      />

      <Card>
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
        </CardHeader>
        <CardContent>
          <EscalaForm mode="create" canManageGlobal={canManageGlobal} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
