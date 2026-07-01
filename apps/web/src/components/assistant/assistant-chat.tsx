'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Loader2, Send, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AssistantStudentResult } from '@soe/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createConversation, searchStudents } from '@/lib/assistant/actions';
import { useAssistant } from './assistant-context';
import { ContextTray, contextChipLabel } from './context-tray';
import { Markdown } from './markdown';
import { readAssistantStream } from './stream';

/**
 * Detecta una mención `@…` en curso: el último `@` antes del cursor que esté al
 * inicio o tras un espacio y sin espacios hasta el cursor. Devuelve el índice del
 * `@` y el texto tipeado, o `null` si no hay mención activa.
 */
function detectMention(value: string, caret: number): { atIndex: number; query: string } | null {
  const upToCaret = value.slice(0, caret);
  const atIndex = upToCaret.lastIndexOf('@');
  if (atIndex === -1) return null;
  const before = atIndex === 0 ? ' ' : upToCaret[atIndex - 1];
  if (before !== ' ' && before !== '\n') return null;
  const query = upToCaret.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { atIndex, query };
}

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

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
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

  // Selector `@` de alumno (H21.11b). Las menciones son contexto del turno: se
  // mandan como pageContext `{ kind: 'student' }` (solo el UUID viaja al LLM).
  const [mentions, setMentions] = useState<AssistantStudentResult[]>([]);
  const [mention, setMention] = useState<{ atIndex: number; query: string } | null>(null);
  const [mentionResults, setMentionResults] = useState<AssistantStudentResult[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const searchSeq = useRef(0);

  // Búsqueda con debounce mientras hay una mención activa.
  useEffect(() => {
    if (!mention) {
      setMentionResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void searchStudents(mention.query)
        .then((res) => {
          if (seq === searchSeq.current) {
            setMentionResults(res);
            setMentionIndex(0);
          }
        })
        .catch(() => {
          if (seq === searchSeq.current) setMentionResults([]);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [mention]);

  const syncMention = useCallback((value: string, caret: number) => {
    setMention(detectMention(value, caret));
  }, []);

  /** Reemplaza el `@query` en curso por el chip y registra la mención. */
  const pickMention = useCallback(
    (student: AssistantStudentResult) => {
      setMentions((prev) => (prev.some((m) => m.id === student.id) ? prev : [...prev, student]));
      setInput((prev) => {
        if (!mention) return prev;
        const caret = textareaRef.current?.selectionStart ?? prev.length;
        return prev.slice(0, mention.atIndex) + prev.slice(caret);
      });
      setMention(null);
      setMentionResults([]);
      queueMicrotask(() => textareaRef.current?.focus());
    },
    [mention],
  );

  const removeMention = useCallback((id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id));
  }, []);

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

      // Contexto = refs de la vista + alumnos mencionados con `@`. Solo kind+id
      // viajan al backend/LLM; el nombre del alumno se queda en el cliente (chip).
      const contextPayload = [
        ...pageContext.map(({ kind, id }) => ({ kind, id })),
        ...mentions.map((m) => ({ kind: 'student' as const, id: m.id })),
      ];

      const res = await fetch(`/api/assistant/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, pageContext: contextPayload }),
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
        <ContextTray />

        {(pageContext.length > 0 || mentions.length > 0) && (
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
            {mentions.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-accent-foreground"
              >
                <AtSign className="size-3" aria-hidden />
                {s.fullName}
                <button
                  type="button"
                  onClick={() => removeMention(s.id)}
                  aria-label={`Quitar a ${s.fullName}`}
                  className="rounded-full hover:text-foreground"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative flex items-end gap-2">
          {mention && mentionResults.length > 0 && (
            <ul className="absolute bottom-full left-0 z-50 mb-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              {mentionResults.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickMention(s);
                    }}
                    onMouseEnter={() => setMentionIndex(i)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                      i === mentionIndex ? 'bg-accent' : 'hover:bg-accent',
                    )}
                  >
                    <AtSign className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{s.fullName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onClick={(e) => syncMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              const popoverOpen = mention !== null && mentionResults.length > 0;
              if (popoverOpen && e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1));
              } else if (popoverOpen && e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex((i) => Math.max(i - 1, 0));
              } else if (popoverOpen && e.key === 'Escape') {
                e.preventDefault();
                setMention(null);
              } else if (popoverOpen && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                pickMention(mentionResults[mentionIndex] ?? mentionResults[0]!);
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Escribe tu pregunta… (@ para mencionar a un alumno)"
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
