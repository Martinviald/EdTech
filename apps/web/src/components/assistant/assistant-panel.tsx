'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AssistantChat } from './assistant-chat';
import { useAssistant } from './assistant-context';

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
