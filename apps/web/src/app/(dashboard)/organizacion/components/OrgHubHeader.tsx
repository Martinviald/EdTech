import Link from 'next/link';

import { auth } from '@/auth';
import { ASSIGNMENTS_ROLES, canAccess } from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { PageHeader, PageTabs } from '@/components/shared';
import { ORGANIZACION_TABS, toPageTabs } from '@/components/layout/view-tabs';

import { getOrgOverview } from '../overview';

/**
 * Encabezado + pestañas compartidas del hub de Organización. Se renderiza en
 * cada tab-page (no en un `layout.tsx`, que también envolvería al wizard de
 * `configurar/`). La pestaña de asignaciones se muestra solo si el rol accede.
 */
export async function OrgHubHeader() {
  const session = await auth();
  const roles = session?.user.roles ?? [];
  const { org, isSetupComplete } = await getOrgOverview();

  const visibleTabs = canAccess(roles, ASSIGNMENTS_ROLES)
    ? ORGANIZACION_TABS
    : ORGANIZACION_TABS.slice(0, 1);

  return (
    <>
      <PageHeader
        title={org.name}
        description="Perfil institucional"
        actions={
          !isSetupComplete ? (
            <Button asChild variant="outline">
              <Link href={ROUTES.organizacionConfigurar}>
                Completar configuración
              </Link>
            </Button>
          ) : undefined
        }
      />
      <PageTabs tabs={toPageTabs(visibleTabs)} sticky />
    </>
  );
}
