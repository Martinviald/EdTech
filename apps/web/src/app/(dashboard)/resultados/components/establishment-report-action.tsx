'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import type { DashboardFilterOptionsResponse } from '@soe/types';
import { apiClientGet } from '@/lib/api-client';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { buildDashboardQuery, parseDashboardFilters, withEntryDefaults } from './dashboard-filters';

const LABEL = 'Generar informe del establecimiento';
const DEFAULTS_STALE_MS = 5 * 60_000;

export const panoramaEntryDefaultsKeys = {
  detail: (query: string) => ['dashboard-filters', query, 'entry-defaults'] as const,
};

/**
 * El proceso que el panorama está mirando: el de la URL o, si la URL no fija proceso
 * ni año ni lo desactiva, el que la página preselecciona (`defaultProcessId`). Sólo
 * en ese último caso pide `/dashboards/filters`, igual que hace la página en el
 * servidor, para que el botón y el filtro hablen del mismo proceso.
 */
function useSelectedProcessId(): string | undefined {
  const searchParams = useSearchParams();
  const filters = parseDashboardFilters(Object.fromEntries(searchParams.entries()));
  const needsDefault = !filters.processId && !filters.processOptOut && !filters.academicYearId;
  const query = buildDashboardQuery(filters);

  const { data } = useQuery({
    queryKey: panoramaEntryDefaultsKeys.detail(query),
    queryFn: () => apiClientGet<DashboardFilterOptionsResponse>(`/dashboards/filters${query}`),
    enabled: needsDefault,
    staleTime: DEFAULTS_STALE_MS,
  });

  if (!needsDefault) return filters.processId;
  if (!data) return undefined;
  return withEntryDefaults(filters, data).processId;
}

/**
 * Acción del encabezado de Panorama: abre el informe del establecimiento del proceso
 * seleccionado. El informe se calcula por proceso, así que sin uno queda deshabilitada.
 * El padre decide si se muestra (`ESTABLISHMENT_REPORT_ROLES`).
 */
export function EstablishmentReportAction() {
  const processId = useSelectedProcessId();

  if (processId) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={ROUTES.procesoInformeEstablecimiento(processId)}>
          <FileText className="size-4 sm:mr-2" aria-hidden />
          <span className="sr-only sm:not-sr-only">{LABEL}</span>
        </Link>
      </Button>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            <Button size="sm" variant="outline" disabled className="pointer-events-none">
              <FileText className="size-4 sm:mr-2" aria-hidden />
              <span className="sr-only sm:not-sr-only">{LABEL}</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Elige un proceso de medición en el filtro</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
