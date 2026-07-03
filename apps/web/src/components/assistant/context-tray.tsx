'use client';

import { Eye, X } from 'lucide-react';
import type { AssistantContextKind, AssistantContextRef } from '@soe/types';
import { cn } from '@/lib/utils';
import { useAssistant } from './assistant-context';
import { ContextPicker } from './context-picker';

/**
 * Etiqueta en español de cada `kind` fijable. Fuente única (DRY): la usan el chip
 * de la bandeja, el fallback del contexto auto y el selector del picker.
 */
export const CONTEXT_KIND_LABELS: Record<AssistantContextKind, string> = {
  assessment: 'Evaluación',
  classGroup: 'Curso',
  grade: 'Grado',
  subject: 'Asignatura',
  instrument: 'Instrumento',
  academicYear: 'Período',
  item: 'Ítem',
  student: 'Alumno',
};

/** Texto del chip: el `label` propio de la ref o el nombre del `kind`. */
export function contextChipLabel(ref: AssistantContextRef): string {
  return ref.label ?? CONTEXT_KIND_LABELS[ref.kind];
}

/**
 * Bandeja de contexto fijable del asistente (E21 — Ola 5). Vive sobre el input del
 * chat: muestra las refs fijadas como chips removibles (estilo del chip `@` de
 * alumno), un botón "Adjuntar lo que veo" (copia el contexto auto de la vista) y un
 * picker (`+`) para buscar y fijar cualquier entidad por nombre. La bandeja persiste
 * en el hilo; el envío del mensaje NO la reenvía (la fusiona el backend).
 */
export function ContextTray() {
  const { pinnedContext, unpinContext, pinCurrentView, pageContext } = useAssistant();

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span className="font-medium">Fijado:</span>

      {pinnedContext.length === 0 && (
        <span className="italic">nada fijado aún</span>
      )}

      {pinnedContext.map((ref) => (
        <span
          key={`${ref.kind}:${ref.id}`}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground"
        >
          <span className="text-[10px] uppercase opacity-70">{CONTEXT_KIND_LABELS[ref.kind]}</span>
          <span className="max-w-[12rem] truncate">{contextChipLabel(ref)}</span>
          <button
            type="button"
            onClick={() => unpinContext(ref.kind, ref.id)}
            aria-label={`Quitar ${contextChipLabel(ref)}`}
            className="rounded-full hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={pinCurrentView}
        disabled={pageContext.length === 0}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5',
          'hover:bg-accent hover:text-accent-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
        )}
      >
        <Eye className="size-3" aria-hidden />
        Adjuntar lo que veo
      </button>

      <ContextPicker />
    </div>
  );
}
