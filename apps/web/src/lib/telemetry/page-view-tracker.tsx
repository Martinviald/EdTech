'use client';

import { useTrackPageView } from './use-track-page-view';

/**
 * Componente sin render que engancha el tracking de page views. Se monta una vez
 * en el layout del dashboard para cubrir toda navegación autenticada.
 */
export function PageViewTracker(): null {
  useTrackPageView();
  return null;
}
