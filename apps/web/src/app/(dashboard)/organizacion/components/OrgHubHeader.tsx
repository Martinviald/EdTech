import Link from 'next/link';

import { auth } from '@/auth';
import { ASSIGNMENTS_ROLES, canAccess } from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { PageActions, PageTabs } from '@/components/shared';
import { ORGANIZACION_TABS, toPageTabs } from '@/components/layout/view-tabs';

import { getOrgOverview } from '../overview';

/**
 * Pestañas (y acción de setup) compartidas del hub de Organización. Se renderiza
 * en cada tab-page (no en un `layout.tsx`, que también envolvería al wizard de
 * `configurar/`). La pestaña de asignaciones se muestra solo si el rol accede.
 * El título del hub lo pinta la barra superior.
 */
export async function OrgHubHeader() {
  const session = await auth();
  const roles = session?.user.roles ?? [];
  const { isSetupComplete } = await getOrgOverview();

  const visibleTabs = canAccess(roles, ASSIGNMENTS_ROLES)
    ? ORGANIZACION_TABS
    : ORGANIZACION_TABS.slice(0, 1);

  return (
    <>
      <PageTabs tabs={toPageTabs(visibleTabs)} sticky />
      {!isSetupComplete ? (
        <PageActions>
          <Button asChild variant="outline">
            <Link href={ROUTES.organizacionConfigurar}>Completar configuración</Link>
          </Button>
        </PageActions>
      ) : null}
    </>
  );
}
