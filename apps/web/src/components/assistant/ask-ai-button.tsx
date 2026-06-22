'use client';

import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAssistant } from './assistant-context';

/**
 * Botón "Pregúntale a la IA sobre esto" (E21 — H21.12). Abre el panel del
 * asistente, opcionalmente con un prompt pre-cargado en el input. El contexto de
 * la vista lo aporta `RegisterAssistantContext` de la propia página (no hace falta
 * pasarlo aquí). Se auto-oculta si el asistente no está habilitado para el usuario
 * (rol + feature), así puede colocarse en cualquier vista sin chequear gating.
 */
export function AskAiButton({
  prompt,
  label = 'Pregúntale a la IA',
  variant = 'outline',
  size = 'sm',
}: {
  prompt?: string;
  label?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
}) {
  const { enabled, openAssistant } = useAssistant();
  if (!enabled) return null;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className="gap-1.5"
      onClick={() => openAssistant(prompt ? { prompt } : undefined)}
    >
      <Sparkles className="size-4" aria-hidden />
      {label}
    </Button>
  );
}
