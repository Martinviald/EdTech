import type { ReactNode } from 'react';
import { Cpu, Gauge, SlidersHorizontal, type LucideIcon } from 'lucide-react';

import {
  AI_OBSERVABILITY_VIEWER_ROLES,
  canAccess,
  GRADING_SCALE_ROLES,
  LLM_SETTINGS_ROLES,
  type UserRole,
} from '@soe/types';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { PageHeader, PageTabs, type PageTab } from '@/components/shared';

type ConfigOption = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: readonly UserRole[];
};

const CONFIG_OPTIONS: readonly ConfigOption[] = [
  {
    href: ROUTES.configEscalas,
    label: 'Escalas de notas',
    icon: SlidersHorizontal,
    roles: GRADING_SCALE_ROLES,
  },
  { href: ROUTES.configModelosIa, label: 'Modelos de IA', icon: Cpu, roles: LLM_SETTINGS_ROLES },
  {
    href: ROUTES.configObservabilidadIa,
    label: 'Observabilidad IA',
    icon: Gauge,
    roles: AI_OBSERVABILITY_VIEWER_ROLES,
  },
];

/**
 * Opciones de configuración a las que el rol tiene acceso. `platform_admin`
 * (por la tabla, no por rol heredado) ve todas — mismo bypass que el RolesGuard.
 */
export function accessibleConfigOptions(
  roles: readonly UserRole[],
  isAdmin: boolean,
): ConfigOption[] {
  return CONFIG_OPTIONS.filter((option) => isAdmin || canAccess(roles, option.roles));
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
      <PageHeader title="Configuración" description={description} actions={actions} />
      <PageTabs tabs={tabs} sticky />
    </>
  );
}
