'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Search } from 'lucide-react';
import {
  ASSISTANT_CONTEXT_KINDS,
  type AssistantContextKind,
  type AssistantContextSearchResponse,
  type AssistantContextSearchResult,
} from '@soe/types';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAssistant } from './assistant-context';
import { CONTEXT_KIND_LABELS } from './context-tray';

/**
 * Picker de contexto del asistente (E21 — Ola 5). Combobox armado con primitivas
 * shadcn existentes (Select + Input + lista de resultados, igual que el selector
 * `@` de alumno): no se agrega `cmdk`/`Command` porque CLAUDE.md prohíbe sumar
 * librerías UI sin consenso. Busca por `kind` + nombre con debounce contra el route
 * handler same-origin `/api/assistant/context-search` y, al elegir, fija la ref en
 * la bandeja (`pinContext`). El `label` viaja solo al chip, nunca al LLM.
 */
export function ContextPicker() {
  const { pinContext } = useAssistant();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AssistantContextKind>('assessment');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AssistantContextSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  // Cerrar al hacer click fuera del panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Búsqueda con debounce mientras el panel está abierto y hay query.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    const seq = ++searchSeq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ kind, q, limit: '10' });
      void fetch(`/api/assistant/context-search?${params.toString()}`)
        .then((res) => (res.ok ? (res.json() as Promise<AssistantContextSearchResponse>) : null))
        .then((json) => {
          if (seq !== searchSeq.current) return;
          setResults(json?.data ?? []);
          setLoading(false);
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setResults([]);
          setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [open, kind, query]);

  const reset = useCallback(() => {
    setQuery('');
    setResults([]);
    setLoading(false);
  }, []);

  const choose = useCallback(
    (result: AssistantContextSearchResult) => {
      pinContext({ kind: result.kind, id: result.id, label: result.label });
      setOpen(false);
      reset();
    },
    [pinContext, reset],
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) queueMicrotask(() => inputRef.current?.focus());
        }}
        aria-label="Agregar contexto"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 hover:bg-accent hover:text-accent-foreground"
      >
        <Plus className="size-3" aria-hidden />
        Agregar
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-72 max-w-[80vw] rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
          <div className="space-y-2">
            <Select value={kind} onValueChange={(v) => setKind(v as AssistantContextKind)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSISTANT_CONTEXT_KINDS.map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">
                    {CONTEXT_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setOpen(false);
                  }
                }}
                placeholder={`Buscar ${CONTEXT_KIND_LABELS[kind].toLowerCase()}…`}
                className="h-8 pl-7 text-xs"
              />
            </div>

            <div className="max-h-48 overflow-y-auto">
              {loading && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  Buscando…
                </div>
              )}

              {!loading && query.trim().length > 0 && results.length === 0 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">Sin resultados.</p>
              )}

              {!loading && results.length > 0 && (
                <ul className="space-y-0.5">
                  {results.map((r) => (
                    <li key={`${r.kind}:${r.id}`}>
                      <button
                        type="button"
                        onClick={() => choose(r)}
                        className={cn(
                          'block w-full truncate rounded px-2 py-1.5 text-left text-xs',
                          'hover:bg-accent hover:text-accent-foreground',
                        )}
                      >
                        {r.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
