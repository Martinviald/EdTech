'use client';

import { Suspense, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FeedbackPanel } from './feedback-panel';

/**
 * Botón flotante de comentarios + su panel. Se monta una sola vez en el layout
 * del dashboard, así está disponible en TODAS las vistas: el feedback que llega
 * es el que se captura donde ocurre la fricción, no el que hay que ir a buscar
 * a un formulario externo.
 *
 * `offset` sube el botón cuando el asistente IA también está montado, para que
 * los dos flotantes no se pisen en la esquina inferior derecha.
 */
export function FeedbackWidget({ offset = false }: { offset?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Enviar un comentario"
        title="Enviar un comentario"
        className={cn(
          'fixed right-6 z-40 flex size-12 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-md transition hover:scale-105 hover:text-foreground hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          offset ? 'bottom-24' : 'bottom-6',
          open && 'pointer-events-none opacity-0',
        )}
      >
        <MessageSquarePlus className="size-5" aria-hidden />
      </button>
      {/* `useSearchParams` (dentro del panel) exige un límite de Suspense. */}
      <Suspense fallback={null}>
        <FeedbackPanel open={open} onOpenChange={setOpen} />
      </Suspense>
    </>
  );
}
