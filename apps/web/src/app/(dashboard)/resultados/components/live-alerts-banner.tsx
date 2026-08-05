'use client';

import type { DashboardAlert } from '@soe/types';
import { useComparableAlerts } from '../hooks/use-comparable-alerts';
import { AlertsBanner } from './alerts-banner';

/**
 * Isla cliente mínima: sólo existe para refrescar las alertas en segundo plano.
 *
 * La presentación sigue viviendo en `AlertsBanner`, que no sabe nada de fetching — así
 * la misma banda se puede renderizar desde el servidor si algún día conviene.
 */
export function LiveAlertsBanner({
  query,
  initialAlerts,
}: {
  query: string;
  initialAlerts: DashboardAlert[];
}) {
  const alerts = useComparableAlerts(query, initialAlerts);
  return <AlertsBanner alerts={alerts} />;
}
