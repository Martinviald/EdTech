import type { ReactNode } from 'react';

import type { UserRole } from '@soe/types';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { BackLink, PageHeader, PageTabs, type PageTab } from '@/components/shared';
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
 * Encabezado + pestañas compartidas del hub de Configuración. Cross-feature: lo
 * usan `configuracion/*` y `observabilidad-ia` (esta última vive en otra ruta
 * pero es parte del mismo hub). Cada tab-page pasa su propia `description`/`actions`.
 */
export async function ConfigHubHeader({
  description,
  actions,
}: {
  description?: string;
  actions?: ReactNode;
}) {
  const session = await auth();
  const roles = session?.user.roles ?? [];
  const isAdmin = Boolean(session?.user.isPlatformAdmin);

  const tabs: PageTab[] = accessibleConfigOptions(roles, isAdmin).map((option) => {
    const Icon = option.icon;
    return { href: option.href, label: option.label, icon: <Icon /> };
  });

  return (
    <>
      <PageHeader
        breadcrumb={<BackLink href={ROUTES.administracion} label="Administración" />}
        title="Configuración"
        description={description}
        actions={actions}
      />
      <PageTabs tabs={tabs} sticky />
    </>
  );
}
