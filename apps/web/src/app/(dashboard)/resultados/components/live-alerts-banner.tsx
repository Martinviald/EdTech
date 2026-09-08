'use client';

import { useComparableAlerts, type ComparableAlertsView } from '../hooks/use-comparable-alerts';
import { AlertsBanner } from './alerts-banner';

/**
 * Isla cliente mínima: sólo existe para refrescar las alertas en segundo plano.
 *
 * La presentación sigue viviendo en `AlertsBanner`, que no sabe nada de fetching — así
 * la misma banda se puede renderizar desde el servidor si algún día conviene.
 */
export function LiveAlertsBanner({
  query,
  initial,
}: {
  query: string;
  initial: ComparableAlertsView;
}) {
  const { alerts, total } = useComparableAlerts(query, initial);
  return <AlertsBanner alerts={alerts} total={total} />;
}
