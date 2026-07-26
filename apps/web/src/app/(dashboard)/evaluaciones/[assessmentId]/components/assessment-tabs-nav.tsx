'use client';

import { PageTabs, type PageTab } from '@/components/shared';

/**
 * Sub-navegación del hub de evaluación. Conserva la querystring (curso/filtros)
 * al cambiar de pestaña y queda fija (`sticky`) bajo el Topbar al hacer scroll.
 * Las pestañas visibles (y su gating por `disabled`/`disabledReason`, ver
 * `PageTab` en components/shared/PageTabs.tsx) se calculan en el layout
 * (server) según los roles del usuario y las `capabilities` de la evaluación;
 * aquí solo se renderizan vía `PageTabs`.
 */
export type HubTab = PageTab;

export function AssessmentTabsNav({ tabs }: { tabs: HubTab[] }) {
  return <PageTabs tabs={tabs} sticky />;
}
