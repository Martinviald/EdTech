'use client';

import { PageTabs } from '@/components/shared';
import { RESULTADOS_TABS, toPageTabs } from '@/components/layout/view-tabs';
import { ResultadosNavActionsSlot } from './nav-actions';

/**
 * Sub-navegación de la sección Resultados. Preserva la querystring (filtros) al
 * cambiar de vista (H6.2), vía `PageTabs`. Las tabs viven en `view-tabs.ts`
 * (fuente única compartida con los `children` del sidebar).
 *
 * El `actions` es el destino donde cada tab teletransporta sus botones (exportar,
 * toggles) para que queden en esta misma fila y no en una banda propia debajo.
 */
export function ResultadosNav() {
  return (
    <PageTabs tabs={toPageTabs(RESULTADOS_TABS)} sticky actions={<ResultadosNavActionsSlot />} />
  );
}
