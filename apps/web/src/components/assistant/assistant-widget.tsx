'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAssistant } from './assistant-context';
import { AssistantPanel } from './assistant-panel';

/**
 * Asistente embebido (E21 — Ola 4): botón flotante + panel lateral. Se monta una
 * sola vez en el layout del dashboard (solo si el usuario tiene rol + feature),
 * por lo que está disponible en TODAS las vistas. El botón se oculta mientras el
 * panel está abierto para no competir con el overlay.
 */
export function AssistantWidget() {
  const { open, openAssistant } = useAssistant();

  return (
    <>
      <button
        type="button"
        onClick={() => openAssistant()}
        aria-label="Abrir asistente IA"
        className={cn(
          'fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          open && 'pointer-events-none opacity-0',
        )}
      >
        <Sparkles className="size-6" aria-hidden />
      </button>
      <AssistantPanel />
    </>
  );
}
