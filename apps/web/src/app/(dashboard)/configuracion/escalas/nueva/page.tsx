import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { canAccess, GRADING_SCALE_ROLES, userHasRole } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/shared';
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
