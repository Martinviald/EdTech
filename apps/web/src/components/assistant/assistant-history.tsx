'use client';

import { useEffect, useState } from 'react';
import { Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AssistantConversationModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { deleteConversation, getConversation, listConversations } from '@/lib/assistant/actions';
import { useAssistant } from './assistant-context';
import type { ChatMessage } from './stream';

const dateFmt = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Lista del historial de conversaciones del usuario (E21 — H21.11). Al elegir una
 * conversación, carga sus mensajes en el provider (vía `getConversation`) y vuelve
 * a la vista de chat. Permite borrar (soft delete en el backend).
 */
export function AssistantHistory({ onOpened }: { onOpened: () => void }) {
  const { conversationId, setConversationId, setMessages } = useAssistant();
  const [items, setItems] = useState<AssistantConversationModel[] | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listConversations(1, 50)
      .then((res) => {
        if (active) setItems(res.data);
      })
      .catch(() => {
        if (active) {
          setItems([]);
          toast.error('No se pudo cargar el historial');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function open(id: string) {
    setLoadingId(id);
    try {
      const detail = await getConversation(id);
      const messages: ChatMessage[] = detail.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tools: m.toolCalls.map((t) => ({ name: t.name, isError: t.isError })),
      }));
      setConversationId(detail.id);
      setMessages(messages);
      onOpened();
    } catch {
      toast.error('No se pudo abrir la conversación');
    } finally {
      setLoadingId(null);
    }
  }

  async function remove(id: string) {
    const prev = items ?? [];
    setItems(prev.filter((c) => c.id !== id)); // optimista
    try {
      await deleteConversation(id);
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
    } catch {
      setItems(prev); // revertir
      toast.error('No se pudo borrar la conversación');
    }
  }

  if (items === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <MessageSquare className="size-6" aria-hidden />
        <p>Aún no tienes conversaciones guardadas.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-1 overflow-y-auto">
      {items.map((c) => (
        <li
          key={c.id}
          className={cn(
            'group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent',
            c.id === conversationId && 'bg-accent',
          )}
        >
          <button
            type="button"
            onClick={() => void open(c.id)}
            disabled={loadingId !== null}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {loadingId === c.id ? (
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{c.title ?? 'Sin título'}</span>
              <span className="block text-xs text-muted-foreground">
                {dateFmt.format(new Date(c.updatedAt))}
              </span>
            </span>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
            aria-label="Borrar conversación"
            onClick={() => void remove(c.id)}
          >
            <Trash2 className="size-4 text-muted-foreground" aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
