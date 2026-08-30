import type { Route } from 'next';

/**
 * Rutas del módulo hojas (E22). Viven acá (no en `lib/routes.ts`) porque ese
 * archivo es compartido y el nav item del módulo se cablea recién en F3 —
 * en integración se pueden promover al mapa global.
 *
 * Nota de estructura: el contrato nombra `/hojas/[instrumentId]/disenar` y
 * `/hojas/[layoutId]/imprimir`, pero Next App Router no permite dos nombres de
 * slug distintos en la misma posición (`[instrumentId]` y `[layoutId]` como
 * hermanos rompen el build). El segmento en disco es `[id]` para ambos; las
 * URLs quedan exactamente como el contrato las define.
 */
export const HOJAS_ROUTES = {
  index: '/hojas' as Route,
  disenar: (instrumentId: string) => `/hojas/${instrumentId}/disenar` as Route,
  imprimir: (layoutId: string) => `/hojas/${layoutId}/imprimir` as Route,
};
