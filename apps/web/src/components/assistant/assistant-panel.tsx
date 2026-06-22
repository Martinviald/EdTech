'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import dynamic from 'next/dynamic';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAssistant } from './assistant-context';

// El chat (y su dependencia react-markdown) se cargan en un chunk aparte, solo
// cuando el panel se monta al abrirse → no pesa el bundle inicial del dashboard.
const AssistantChat = dynamic(() => import('./assistant-chat').then((m) => m.AssistantChat), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
    </div>
  ),
});

// ── Ancho redimensionable del panel ──────────────────────────────────────────
const WIDTH_STORAGE_KEY = 'soe.assistant.panelWidth';
const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 360;
const KEYBOARD_STEP = 24;

/** Acota el ancho a [MIN, min(900, viewport−32)] para no desbordar la pantalla. */
function clampWidth(width: number): number {
  const viewport = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const max = Math.min(900, viewport - 32);
  return Math.max(MIN_WIDTH, Math.min(width, max));
}

/**
 * Ancho del panel persistido en localStorage y ajustable arrastrando el borde
 * izquierdo (el panel ancla a la derecha → ancho = distancia del cursor al borde
 * derecho de la ventana). Re-acota ante `resize` para no quedar más ancho que la
 * pantalla. Devuelve el ancho y los handlers del tirador (puntero + teclado).
 */
function useResizableWidth() {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const widthRef = useRef(DEFAULT_WIDTH);

  const apply = useCallback((next: number) => {
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    setWidth(clamped);
  }, []);

  // Hidratar desde localStorage tras montar (evita mismatch SSR) + re-acotar en resize.
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    apply(Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_WIDTH);

    const onResize = () => apply(widthRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [apply]);

  const persist = useCallback(() => {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMove = (ev: PointerEvent) => apply(window.innerWidth - ev.clientX);
      const onUp = () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        persist();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [apply, persist],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      // Borde izquierdo: ← ensancha, → angosta.
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        apply(widthRef.current + KEYBOARD_STEP);
        persist();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        apply(widthRef.current - KEYBOARD_STEP);
        persist();
      }
    },
    [apply, persist],
  );

  return { width, onPointerDown, onKeyDown };
}

/**
 * Panel lateral del asistente embebido (E21 — Ola 4). `Sheet` (drawer) controlado
 * por el estado del provider; aloja el chat reutilizable. El hilo persiste en el
 * provider, así que cerrar el panel no pierde la conversación. Ancho ajustable
 * arrastrando el borde izquierdo, persistido en localStorage.
 */
export function AssistantPanel() {
  const { open, setOpen, resetConversation, messages } = useAssistant();
  const { width, onPointerDown, onKeyDown } = useResizableWidth();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        style={{ width, maxWidth: '95vw' }}
        className="flex max-w-none flex-col gap-3"
      >
        {/* Tirador de redimensionado en el borde izquierdo (panel ancla derecha). */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ajustar ancho del panel"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          className="group absolute inset-y-0 left-0 z-50 flex w-2 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
        >
          <span className="h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
        </div>

        <SheetHeader className="pr-8 text-left">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>Asistente IA</SheetTitle>
            {messages.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={resetConversation}
              >
                <Plus className="size-3.5" aria-hidden />
                Nueva
              </Button>
            )}
          </div>
          <SheetDescription>
            Pregúntale a tus datos. Toda cifra proviene de tus resultados reales.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1">
          <AssistantChat />
        </div>
      </SheetContent>
    </Sheet>
  );
}
