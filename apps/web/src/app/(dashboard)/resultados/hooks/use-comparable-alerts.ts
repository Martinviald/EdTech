'use client';

import { useQuery } from '@tanstack/react-query';
import type { ComparableOverviewResponse, DashboardAlert } from '@soe/types';
import { apiClientGet } from '@/lib/api-client';

/**
 * Mantiene viva la banda de alertas del panorama sin convertir la página en cliente.
 *
 * El resto del panorama sigue siendo RSC: se renderiza una vez y no cambia hasta que el
 * usuario navega o toca un filtro. Las alertas son lo único que sí cambia solo —
 * termina una importación, se recalculan resultados— y enterarse de eso no debería
 * exigir recargar. Por eso este hook recibe `initialAlerts` del servidor (así el primer
 * paint no espera ningún fetch) y a partir de ahí refresca en segundo plano.
 *
 * TanStack Query pausa el intervalo cuando la pestaña no está en foco, así que un
 * tablero abierto y olvidado no golpea la API indefinidamente.
 */

const REFRESH_INTERVAL_MS = 60_000;

export const comparableAlertsKeys = {
  detail: (query: string) => ['comparable-overview', query, 'alerts'] as const,
};

export function useComparableAlerts(query: string, initialAlerts: DashboardAlert[]) {
  const { data } = useQuery({
    queryKey: comparableAlertsKeys.detail(query),
    queryFn: () =>
      apiClientGet<ComparableOverviewResponse>(`/dashboards/comparable-overview${query}`),
    refetchInterval: REFRESH_INTERVAL_MS,
    initialData: undefined,
  });

  return data?.alerts ?? initialAlerts;
}
