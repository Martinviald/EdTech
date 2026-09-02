'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface FeedbackContextValue {
  open: boolean;
  openFeedback: () => void;
  setOpen: (open: boolean) => void;
}

const FeedbackCtx = createContext<FeedbackContextValue | null>(null);

/**
 * Estado del panel de comentarios, elevado a contexto para que el widget no sea
 * su única puerta de entrada: el menú de usuario también lo abre.
 *
 * Que la acción viva en dos lugares no es duplicación — el botón flotante cubre
 * el descubrimiento pasivo (la persona lo ve sin buscarlo) y el menú cubre la
 * búsqueda activa (la persona ya sabe que existe y va a buscarlo donde están las
 * demás acciones de su cuenta).
 */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openFeedback = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ open, openFeedback, setOpen }), [open, openFeedback]);

  return <FeedbackCtx.Provider value={value}>{children}</FeedbackCtx.Provider>;
}

/**
 * Devuelve `null` fuera del provider en vez de lanzar: el menú de usuario se
 * monta también en el panel de plataforma, donde el widget no existe. Quien
 * consuma esto debe ocultar su entrada si no hay contexto.
 */
export function useFeedback(): FeedbackContextValue | null {
  return useContext(FeedbackCtx);
}
