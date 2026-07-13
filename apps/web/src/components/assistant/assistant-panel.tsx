'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeft, History, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useResizablePanelWidth, PanelResizeHandle } from '@/hooks/use-resizable-panel-width';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAssistant } from './assistant-context';
import { AssistantHistory } from './assistant-history';

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

/**
 * Panel lateral del asistente embebido (E21 — Ola 4). `Sheet` (drawer) controlado
 * por el estado del provider; aloja el chat reutilizable. El hilo persiste en el
 * provider, así que cerrar el panel no pierde la conversación. Ancho ajustable
 * arrastrando el borde izquierdo, persistido en localStorage.
 */
export function AssistantPanel() {
  const { open, setOpen, resetConversation, messages } = useAssistant();
  const { width, onPointerDown, onKeyDown } = useResizablePanelWidth({
    storageKey: 'soe.assistant.panelWidth',
    defaultWidth: 440,
    minWidth: 360,
  });
  const [view, setView] = useState<'chat' | 'history'>('chat');

  // Al cerrar el panel, volver a la vista de chat para la próxima apertura.
  useEffect(() => {
    if (!open) setView('chat');
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        style={{ width, maxWidth: '95vw' }}
        className="flex max-w-none flex-col gap-3"
      >
        {/* Tirador de redimensionado en el borde izquierdo (panel ancla derecha). */}
        <PanelResizeHandle onPointerDown={onPointerDown} onKeyDown={onKeyDown} />

        <SheetHeader className="pr-8 text-left">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>{view === 'history' ? 'Historial' : 'Asistente IA'}</SheetTitle>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
              >
                {view === 'history' ? (
                  <>
                    <ArrowLeft className="size-3.5" aria-hidden />
                    Volver
                  </>
                ) : (
                  <>
                    <History className="size-3.5" aria-hidden />
                    Historial
                  </>
                )}
              </Button>
              {view === 'chat' && messages.length > 0 && (
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
          </div>
          <SheetDescription>
            Pregúntale a tus datos. Toda cifra proviene de tus resultados reales.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1">
          {view === 'history' ? (
            <AssistantHistory onOpened={() => setView('chat')} />
          ) : (
            <AssistantChat />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
