'use client';

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

/**
 * Panel lateral del asistente embebido (E21 — Ola 4). `Sheet` (drawer) controlado
 * por el estado del provider; aloja el chat reutilizable. El hilo persiste en el
 * provider, así que cerrar el panel no pierde la conversación.
 */
export function AssistantPanel() {
  const { open, setOpen, resetConversation, messages } = useAssistant();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-md">
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
