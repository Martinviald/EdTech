import type { ReactNode } from 'react';

import type { UserRole } from '@soe/types';
import { auth } from '@/auth';
import { PageActions, PageTabs, type PageTab } from '@/components/shared';
import {
  accessibleHubOptions,
  CONFIG_HUB_OPTIONS,
  type AdminHubOption,
} from '@/components/layout/admin-hub';

/**
 * Opciones de configuración a las que el rol tiene acceso. `platform_admin`
 * (por la tabla, no por rol heredado) ve todas — mismo bypass que el RolesGuard.
 */
export function accessibleConfigOptions(
  roles: readonly UserRole[],
  isAdmin: boolean,
): AdminHubOption[] {
  return accessibleHubOptions(CONFIG_HUB_OPTIONS, roles, isAdmin);
}

/**
 * Pestañas compartidas del hub de Configuración. Cross-feature: las usan
 * `configuracion/*` y `observabilidad-ia` (esta última vive en otra ruta pero es
 * parte del mismo hub). El título del hub lo pinta la barra superior; cada
 * tab-page pasa sus propias `actions`.
 */
export async function ConfigHubHeader({ actions }: { actions?: ReactNode }) {
  const session = await auth();
  const roles = session?.user.roles ?? [];
  const isAdmin = Boolean(session?.user.isPlatformAdmin);

  const tabs: PageTab[] = accessibleConfigOptions(roles, isAdmin).map((option) => {
    const Icon = option.icon;
    return { href: option.href, label: option.label, icon: <Icon /> };
  });

  return (
    <>
      <PageTabs tabs={tabs} sticky />
      {actions ? <PageActions>{actions}</PageActions> : null}
    </>
  );
}
