'use client';

import type { AssistantContextRef } from '@soe/types';
import { useRegisterAssistantContext } from './assistant-context';

/**
 * Declara el contexto de la vista actual para el asistente embebido (E21).
 *
 * Pensado para usarse desde Server Components: una página renderiza
 * `<RegisterAssistantContext refs={[{ kind: 'assessment', id }, …]} />` y el
 * panel del asistente recibe esas refs (UUIDs) al abrirse. El `label` es opcional
 * y solo para la UI — nunca viaja al backend/LLM (PII opción B). No renderiza nada.
 */
export function RegisterAssistantContext({ refs }: { refs: AssistantContextRef[] }): null {
  useRegisterAssistantContext(refs);
  return null;
}
