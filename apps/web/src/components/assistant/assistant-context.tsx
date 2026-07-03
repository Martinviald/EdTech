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
  /** `true` si el asistente está montado para este usuario (rol + feature). */
  enabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Abre el panel; opcionalmente con un prompt pre-cargado en el input. */
  openAssistant: (opts?: { prompt?: string }) => void;
  /** Contexto de la vista actual (refs por UUID; el `label` es solo para la UI). */
  pageContext: AssistantContextRef[];
  setPageContext: (refs: AssistantContextRef[]) => void;
  // ── Bandeja de contexto FIJADA por el usuario (E21 — Ola 5) ──────────────────
  // Separada del `pageContext` (auto/efímero): persiste entre turnos en
  // `pinned_context` del hilo. Al mutar se guarda vía PUT …/context. El backend la
  // fusiona con el `pageContext` al armar el turno → el cliente NO la reenvía.
  /** Bandeja fijada (refs con `label` para el chip; solo `kind`+`id` van al LLM). */
  pinnedContext: AssistantContextRef[];
  /** Fija una ref (dedup por `kind`+`id`) y persiste la bandeja. */
  pinContext: (ref: AssistantContextRef) => void;
  /** Quita una ref de la bandeja y persiste. */
  unpinContext: (kind: AssistantContextRef['kind'], id: string) => void;
  /** Copia el `pageContext` actual (lo que el usuario ve) a la bandeja (dedup). */
  pinCurrentView: () => void;
  /** Lee y limpia el prompt sugerido (lo consume el chat al abrirse). */
  consumeSeedPrompt: () => string | null;
  // ── Conversación viva (persiste mientras el dashboard esté montado, así el ──
  // ── hilo sobrevive al cerrar el panel y al navegar entre vistas) ──
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  /** Rehidrata la bandeja desde el detalle de un hilo (NO re-persiste). */
  hydratePinnedContext: (refs: AssistantContextRef[]) => void;
  /** Descarta el hilo actual (botón "nueva conversación"). */
  resetConversation: () => void;
}

const AssistantCtx = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({
  children,
  enabled = false,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pageContext, setPageContext] = useState<AssistantContextRef[]>([]);
  const [pinnedContext, setPinnedContext] = useState<AssistantContextRef[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const seedPromptRef = useRef<string | null>(null);

  // Última bandeja conocida + flag "pendiente de persistir": si el usuario fija
  // refs ANTES de que exista la conversación (se crea perezosamente al 1er mensaje),
  // las guardamos en cuanto aparece el `conversationId`.
  const pinnedRef = useRef<AssistantContextRef[]>([]);
  const pinnedDirtyRef = useRef(false);

  const openAssistant = useCallback((opts?: { prompt?: string }) => {
    if (opts?.prompt) seedPromptRef.current = opts.prompt;
    setOpen(true);
  }, []);

  const consumeSeedPrompt = useCallback(() => {
    const prompt = seedPromptRef.current;
    seedPromptRef.current = null;
    return prompt;
  }, []);

  /** Persiste la bandeja en el hilo (PUT). Solo si ya hay conversación. */
  const persistPinned = useCallback(async (convId: string, refs: AssistantContextRef[]) => {
    try {
      const res = await fetch(`/api/assistant/conversations/${convId}/context`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinnedContext: refs }),
      });
      if (res.ok) pinnedDirtyRef.current = false;
    } catch {
      // Se mantiene `dirty`: se reintenta cuando vuelva a mutar la bandeja.
    }
  }, []);

  /** Aplica una nueva bandeja (estado + ref), la marca sucia y la persiste. */
  const commitPinned = useCallback(
    (refs: AssistantContextRef[]) => {
      pinnedRef.current = refs;
      pinnedDirtyRef.current = true;
      setPinnedContext(refs);
      if (conversationId) void persistPinned(conversationId, refs);
    },
    [conversationId, persistPinned],
  );

  const pinContext = useCallback(
    (ref: AssistantContextRef) => {
      if (pinnedRef.current.some((r) => r.kind === ref.kind && r.id === ref.id)) return;
      commitPinned([...pinnedRef.current, ref]);
    },
    [commitPinned],
  );

  const unpinContext = useCallback(
    (kind: AssistantContextRef['kind'], id: string) => {
      commitPinned(pinnedRef.current.filter((r) => !(r.kind === kind && r.id === id)));
    },
    [commitPinned],
  );

  const pinCurrentView = useCallback(() => {
    const merged = [...pinnedRef.current];
    for (const ref of pageContext) {
      if (!merged.some((r) => r.kind === ref.kind && r.id === ref.id)) merged.push(ref);
    }
    if (merged.length !== pinnedRef.current.length) commitPinned(merged);
  }, [commitPinned, pageContext]);

  /** Rehidrata la bandeja desde el detalle de un hilo; NO la re-persiste. */
  const hydratePinnedContext = useCallback((refs: AssistantContextRef[]) => {
    pinnedRef.current = refs;
    pinnedDirtyRef.current = false;
    setPinnedContext(refs);
  }, []);

  // Conversación recién creada con bandeja pendiente → persistir ahora.
  useEffect(() => {
    if (conversationId && pinnedDirtyRef.current) {
      void persistPinned(conversationId, pinnedRef.current);
    }
  }, [conversationId, persistPinned]);

  const resetConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    hydratePinnedContext([]);
  }, [hydratePinnedContext]);

  const value = useMemo<AssistantContextValue>(
    () => ({
      enabled,
      open,
      setOpen,
      openAssistant,
      pageContext,
      setPageContext,
      pinnedContext,
      pinContext,
      unpinContext,
      pinCurrentView,
      consumeSeedPrompt,
      messages,
      setMessages,
      conversationId,
      setConversationId,
      hydratePinnedContext,
      resetConversation,
    }),
    [
      enabled,
      open,
      openAssistant,
      pageContext,
      pinnedContext,
      pinContext,
      unpinContext,
      pinCurrentView,
      consumeSeedPrompt,
      messages,
      conversationId,
      hydratePinnedContext,
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
