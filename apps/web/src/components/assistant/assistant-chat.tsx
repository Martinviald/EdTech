'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { AssistantContextKind, AssistantContextRef } from '@soe/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createConversation } from '@/lib/assistant/actions';
import { useAssistant } from './assistant-context';
import { Markdown } from './markdown';
import { readAssistantStream } from './stream';

/** Nombre legible de cada tool, para el indicador "consultando datos…". */
const TOOL_LABELS: Record<string, string> = {
  list_filter_options: 'opciones de filtro',
  get_dashboard_overview: 'resumen del dashboard',
  get_dashboard_skills: 'logro por habilidad',
  get_dashboard_performance: 'distribución de desempeño',
  get_heatmap: 'mapa de calor',
  get_progression: 'progresión temporal',
  get_generational: 'comparación generacional',
  get_assessment_report: 'informe de la evaluación',
  get_student_detail: 'detalle de alumno',
  get_item_content: 'contenido del ítem',
};

/** Etiqueta del chip de contexto cuando la ref no trae `label` propio. */
const CONTEXT_KIND_LABELS: Record<AssistantContextKind, string> = {
  assessment: 'Evaluación',
  classGroup: 'Curso',
  grade: 'Grado',
  subject: 'Asignatura',
  instrument: 'Instrumento',
  academicYear: 'Período',
  item: 'Ítem',
  student: 'Alumno',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function contextChipLabel(ref: AssistantContextRef): string {
  return ref.label ?? CONTEXT_KIND_LABELS[ref.kind];
}

/** Inserta o actualiza una traza de tool por nombre (dedup para el chip). */
function upsertTool(
  tools: { name: string; isError: boolean }[],
  name: string,
  isError: boolean,
): { name: string; isError: boolean }[] {
  const existing = tools.find((t) => t.name === name);
  if (existing) {
    return tools.map((t) => (t.name === name ? { ...t, isError } : t));
  }
  return [...tools, { name, isError }];
}

/**
 * Chat del asistente IA (E21 — Ola 4). Reutilizable por el panel lateral embebido
 * y por la futura ruta `/asistente`. Estado del hilo (mensajes + conversationId)
 * vive en el provider → sobrevive al cerrar el panel y al navegar.
 *
 * Streaming: POST al route handler same-origin `/api/assistant/.../messages`
 * (que adjunta el Bearer desde la cookie httpOnly y reenvía el SSE del backend).
 * Render incremental de `text_delta` + indicador de tool-calls. El `pageContext`
 * se envía SIN `label` (PII opción B: solo `kind`+`id` UUID viajan al backend).
 */
export function AssistantChat() {
  const {
    pageContext,
    messages,
    setMessages,
    conversationId,
    setConversationId,
    consumeSeedPrompt,
  } = useAssistant();

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Prompt sugerido (deep-link "pregúntale sobre esto") + foco al montar.
  useEffect(() => {
    const seed = consumeSeedPrompt();
    if (seed) setInput(seed);
    textareaRef.current?.focus();
  }, [consumeSeedPrompt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activity]);

  async function send() {
    const content = input.trim();
    if (!content || isStreaming) return;

    setInput('');
    setIsStreaming(true);
    setActivity(null);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content, tools: [] },
      { id: assistantId, role: 'assistant', content: '', tools: [] },
    ]);

    try {
      let convId = conversationId;
      if (!convId) {
        const conv = await createConversation();
        convId = conv.id;
        setConversationId(convId);
      }

      const res = await fetch(`/api/assistant/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          // Solo kind+id viajan al backend/LLM; el label se queda en el cliente.
          pageContext: pageContext.map(({ kind, id }) => ({ kind, id })),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'No se pudo enviar el mensaje');
      }

      await readAssistantStream(res, (ev) => {
        switch (ev.type) {
          case 'text_delta':
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + ev.text } : m)),
            );
            break;
          case 'tool_call':
            setActivity(toolLabel(ev.name));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, tools: upsertTool(m.tools, ev.name, false) } : m,
              ),
            );
            break;
          case 'tool_result':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, tools: upsertTool(m.tools, ev.name, ev.isError) }
                  : m,
              ),
            );
            break;
          case 'error':
            throw new Error(ev.message);
          case 'done':
            break;
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error del asistente';
      toast.error(message);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.content.length === 0 ? { ...m, content: `⚠️ ${message}` } : m,
        ),
      );
    } finally {
      setIsStreaming(false);
      setActivity(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
            <Sparkles className="size-6 text-primary" aria-hidden />
            <p className="font-medium text-foreground">¿En qué te ayudo con tus datos?</p>
            <p>
              Pregúntame sobre resultados, brechas o ítems. Si estás viendo una evaluación o un
              curso, ya tengo ese contexto.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={cn('flex flex-col gap-1', m.role === 'user' ? 'items-end' : 'items-start')}
          >
            {m.role === 'assistant' && m.tools.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {m.tools.map((t) => (
                  <span
                    key={t.name}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px]',
                      t.isError
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {toolLabel(t.name)}
                  </span>
                ))}
              </div>
            )}
            <div
              className={cn(
                'max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm',
                m.role === 'user'
                  ? 'whitespace-pre-wrap bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              )}
            >
              {m.role === 'assistant' ? (
                m.content ? (
                  <Markdown>{m.content}</Markdown>
                ) : isStreaming ? (
                  '…'
                ) : (
                  ''
                )
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}

        {activity && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            <span>Consultando datos… ({activity})</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="space-y-2 border-t pt-3"
      >
        {pageContext.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>Contexto:</span>
            {pageContext.map((ref) => (
              <span
                key={`${ref.kind}:${ref.id}`}
                className="rounded-full bg-accent px-2 py-0.5 text-accent-foreground"
              >
                {contextChipLabel(ref)}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Escribe tu pregunta…"
            disabled={isStreaming}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isStreaming || input.trim().length === 0}
            aria-label="Enviar"
          >
            {isStreaming ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
