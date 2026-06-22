'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AssistantContextRef } from '@soe/types';
import type { ChatMessage } from './stream';

/**
 * Estado compartido del asistente embebido (E21 — Ola 4): si el panel está
 * abierto, el contexto de la vista actual (refs tipadas que el usuario está
 * viendo) y un prompt sugerido opcional (deep-link "pregúntale sobre esto").
 *
 * Vive en un React Context (el repo no usa Zustand): se monta en el layout del
 * dashboard envolviendo tanto las páginas como el panel, de modo que una vista
 * pueda DECLARAR su contexto (`useRegisterAssistantContext`) y el panel lo lea.
 */
interface AssistantContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Abre el panel; opcionalmente con un prompt pre-cargado en el input. */
  openAssistant: (opts?: { prompt?: string }) => void;
  /** Contexto de la vista actual (refs por UUID; el `label` es solo para la UI). */
  pageContext: AssistantContextRef[];
  setPageContext: (refs: AssistantContextRef[]) => void;
  /** Lee y limpia el prompt sugerido (lo consume el chat al abrirse). */
  consumeSeedPrompt: () => string | null;
  // ── Conversación viva (persiste mientras el dashboard esté montado, así el ──
  // ── hilo sobrevive al cerrar el panel y al navegar entre vistas) ──
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  /** Descarta el hilo actual (botón "nueva conversación"). */
  resetConversation: () => void;
}

const AssistantCtx = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pageContext, setPageContext] = useState<AssistantContextRef[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const seedPromptRef = useRef<string | null>(null);

  const openAssistant = useCallback((opts?: { prompt?: string }) => {
    if (opts?.prompt) seedPromptRef.current = opts.prompt;
    setOpen(true);
  }, []);

  const consumeSeedPrompt = useCallback(() => {
    const prompt = seedPromptRef.current;
    seedPromptRef.current = null;
    return prompt;
  }, []);

  const resetConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
  }, []);

  const value = useMemo<AssistantContextValue>(
    () => ({
      open,
      setOpen,
      openAssistant,
      pageContext,
      setPageContext,
      consumeSeedPrompt,
      messages,
      setMessages,
      conversationId,
      setConversationId,
      resetConversation,
    }),
    [
      open,
      openAssistant,
      pageContext,
      consumeSeedPrompt,
      messages,
      conversationId,
      resetConversation,
    ],
  );

  return <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>;
}

/** Acceso al estado del asistente. Lanza si se usa fuera del provider. */
export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantCtx);
  if (!ctx) throw new Error('useAssistant debe usarse dentro de <AssistantProvider>');
  return ctx;
}

/**
 * Declara el contexto de la vista actual mientras el componente esté montado, y
 * lo limpia al desmontar. Cada página/vista lo llama con sus refs (la lista de
 * `kind` es finita y acotada por las tools). Patrón declarativo: agregar una
 * vista NO toca un mapa central — solo declara aquí sus refs.
 *
 * Tolerante a estar fuera del provider (no-op): así una vista puede declarar su
 * contexto aunque el asistente no esté habilitado para ese usuario.
 */
export function useRegisterAssistantContext(refs: AssistantContextRef[]): void {
  const ctx = useContext(AssistantCtx);
  const setPageContext = ctx?.setPageContext;
  // Clave estable: re-registra solo si cambian los refs (no en cada render).
  const key = JSON.stringify(refs);

  useEffect(() => {
    if (!setPageContext) return;
    setPageContext(refs);
    return () => setPageContext([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setPageContext]);
}
