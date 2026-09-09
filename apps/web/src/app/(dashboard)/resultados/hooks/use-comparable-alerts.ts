'use client';

import { useQuery } from '@tanstack/react-query';
import type { ComparableAlertsResponse, DashboardAlert } from '@soe/types';
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
 *
 * `initialAlerts` entra como `initialData`, no como valor de respaldo: sin eso el
 * hook dispara un fetch al montar y cada carga del panorama pedía DOS veces el
 * endpoint más caro de la app (una en el RSC, otra en el cliente, con ~200 ms de
 * diferencia). Con `staleTime` igual al intervalo, lo que el servidor acaba de
 * renderizar se considera fresco y el primer refetch recién ocurre al minuto — eso
 * también evita que un cambio de foco de pestaña vuelva a pedirlo entero.
 */

const REFRESH_INTERVAL_MS = 60_000;

export const comparableAlertsKeys = {
  detail: (query: string) => ['comparable-overview', query, 'alerts'] as const,
};

export type ComparableAlertsView = {
  alerts: DashboardAlert[];
  total: number;
};

export function useComparableAlerts(
  query: string,
  initial: ComparableAlertsView,
): ComparableAlertsView {
  const { data } = useQuery({
    queryKey: comparableAlertsKeys.detail(query),
    queryFn: async () => {
      const response = await apiClientGet<ComparableAlertsResponse>(
        `/dashboards/comparable-overview/alerts${query}`,
      );
      return { alerts: response.alerts, total: response.alertsTotal };
    },
    refetchInterval: REFRESH_INTERVAL_MS,
    staleTime: REFRESH_INTERVAL_MS,
    initialData: initial,
    initialDataUpdatedAt: Date.now(),
  });

  return data;
}
