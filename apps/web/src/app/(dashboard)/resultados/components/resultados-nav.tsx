'use client';

import { Suspense } from 'react';
import { PageTabs } from '@/components/shared';
import { RESULTADOS_TABS, toPageTabs } from '@/components/layout/view-tabs';
import { ResultadosNavActionsSlot } from './nav-actions';
import { EstablishmentReportAction } from './establishment-report-action';

/**
 * Sub-navegación de la sección Resultados. Preserva la querystring (filtros) al
 * cambiar de vista (H6.2), vía `PageTabs`. Las tabs viven en `view-tabs.ts`
 * (fuente única compartida con los `children` del sidebar).
 *
 * El `actions` es el destino donde cada tab teletransporta sus botones (exportar,
 * toggles) para que queden en esta misma fila y no en una banda propia debajo.
 * Antes del destino va la acción fija del encabezado: abrir el informe del
 * establecimiento del proceso seleccionado, sólo para quien puede verlo.
 */
export function ResultadosNav({
  canOpenEstablishmentReport,
}: {
  canOpenEstablishmentReport: boolean;
}) {
  return (
    <PageTabs
      tabs={toPageTabs(RESULTADOS_TABS)}
      sticky
      actions={
        <>
          {canOpenEstablishmentReport ? (
            <Suspense fallback={null}>
              <EstablishmentReportAction />
            </Suspense>
          ) : null}
          <ResultadosNavActionsSlot />
        </>
      }
    />
  );
}
