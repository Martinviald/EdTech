'use client';

import { Suspense } from 'react';
import { MessageSquarePlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FeedbackPanel } from './feedback-panel';
import { useFeedback } from './feedback-context';
import { useCollapseOnScroll } from './use-collapse-on-scroll';
import { useFirstTimeHint } from './use-first-time-hint';

/**
 * Botón flotante de comentarios + su panel. Se monta una sola vez en el layout
 * del dashboard, así está disponible en TODAS las vistas: el feedback que llega
 * es el que se captura donde ocurre la fricción, no el que hay que ir a buscar
 * a un formulario externo.
 *
 * El botón lleva TEXTO, no sólo el ícono. Un bocadillo solo puede leerse como
 * chat, ayuda, notificaciones o soporte; la palabra elimina la adivinanza, y era
 * la razón principal por la que el widget pasaba desapercibido. Colapsa a
 * círculo mientras se hace scroll para no estorbar en tablas largas.
 *
 * `offset` sube el botón cuando el asistente IA también está montado, para que
 * los dos flotantes no se pisen en la esquina inferior derecha.
 *
 * `data-feedback-ui` excluye el botón (y el aviso) de la captura automática de
 * pantalla: no aportan al reporte y confunden sobre dónde estaba la persona.
 */
export function FeedbackWidget({ offset = false }: { offset?: boolean }) {
  const feedback = useFeedback();
  const scrolling = useCollapseOnScroll();
  const { visible: hintVisible, dismiss: dismissHint } = useFirstTimeHint();

  if (!feedback) return null;
  const { open, openFeedback, setOpen } = feedback;

  // Mientras el aviso está en pantalla el botón NO colapsa: el globo apunta a él.
  const collapsed = scrolling && !hintVisible;

  return (
    <>
      <div
        data-feedback-ui=""
        className={cn(
          'fixed right-6 z-40 flex flex-col items-end gap-2 transition-opacity',
          offset ? 'bottom-24' : 'bottom-6',
          open && 'pointer-events-none opacity-0',
        )}
      >
        {hintVisible && (
          <div
            role="status"
            className="relative max-w-[16rem] rounded-lg border border-border bg-popover p-3 pr-8 text-sm text-popover-foreground shadow-lg"
          >
            <p>¿Algo no funciona o se puede mejorar? Cuéntanos desde aquí.</p>
            <button
              type="button"
              onClick={dismissHint}
              aria-label="Cerrar el aviso"
              className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            dismissHint();
            openFeedback();
          }}
          aria-label="Enviar un comentario"
          className={cn(
            'flex h-12 items-center justify-center gap-2 rounded-full border border-border bg-background text-sm font-medium text-foreground shadow-md transition-all hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            collapsed ? 'w-12 px-0' : 'px-4',
          )}
        >
          <MessageSquarePlus className="size-5 shrink-0" aria-hidden />
          {/* Se oculta con `hidden` y no desmontando, para que el ancho anime. */}
          <span className={cn('whitespace-nowrap', collapsed && 'sr-only')}>Comentarios</span>
        </button>
      </div>

      {/* `useSearchParams` (dentro del panel) exige un límite de Suspense. */}
      <Suspense fallback={null}>
        <FeedbackPanel open={open} onOpenChange={setOpen} />
      </Suspense>
    </>
  );
}
