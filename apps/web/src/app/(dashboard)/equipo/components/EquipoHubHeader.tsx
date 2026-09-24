import { auth } from '@/auth';
import { ASSIGNMENTS_ROLES, canAccess, STAFF_MANAGEMENT_ROLES } from '@soe/types';
import { PageTabs } from '@/components/shared';
import { EQUIPO_TABS, toPageTabs } from '@/components/layout/view-tabs';
import { ROUTES } from '@/lib/routes';

/**
 * Pestañas del hub de Equipo (Miembros / Asignaciones docentes). Se renderiza en
 * cada tab-page y no en un `layout.tsx`, que también envolvería a la ficha de un
 * miembro (`/equipo/[userId]`).
 *
 * Cada pestaña se muestra según su propia política: gestionar miembros es
 * `STAFF_MANAGEMENT_ROLES` y asignar carga docente es `ASSIGNMENTS_ROLES`, que
 * además incluye al academic_director.
 */
export async function EquipoHubHeader() {
  const session = await auth();
  const roles = session?.user.roles ?? [];
  const allowed: Record<string, boolean> = {
    [ROUTES.equipo]: canAccess(roles, STAFF_MANAGEMENT_ROLES),
    [ROUTES.equipoAsignaciones]: canAccess(roles, ASSIGNMENTS_ROLES),
  };

  return <PageTabs tabs={toPageTabs(EQUIPO_TABS.filter((tab) => allowed[tab.href]))} sticky />;
}
