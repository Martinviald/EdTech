'use client';

import { MessageSquarePlus } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useFeedback } from './feedback-context';

/**
 * Entrada "Enviar un comentario" del menú de usuario. Segunda puerta al mismo
 * panel: cubre a quien busca las acciones en los menús en vez de en la pantalla.
 *
 * No renderiza nada fuera del `FeedbackProvider` — el menú de usuario se monta
 * también en el panel de plataforma, donde el widget no existe.
 */
export function FeedbackMenuItem() {
  const feedback = useFeedback();
  if (!feedback) return null;

  return (
    <DropdownMenuItem onSelect={() => feedback.openFeedback()}>
      <MessageSquarePlus className="size-4" aria-hidden />
      Enviar un comentario
    </DropdownMenuItem>
  );
}
