'use client';

import { useSearchParams } from 'next/navigation';
import type { AssistantContextRef } from '@soe/types';
import { RegisterAssistantContext } from '@/components/assistant';

/**
 * Declara el contexto del asistente (E21) para TODO el hub de evaluación, una
 * sola vez en el layout. Lee `classGroupId` de la querystring (que las pestañas
 * conservan) y lo combina con la evaluación del path. Vive en el layout porque
 * `useRegisterAssistantContext` reemplaza el contexto completo: montar uno por
 * pestaña haría que se pisaran entre sí.
 */
export function HubAssistantContext({
  assessmentId,
  label,
}: {
  assessmentId: string;
  label?: string;
}) {
  const searchParams = useSearchParams();
  const classGroupId = searchParams.get('classGroupId') ?? undefined;

  const refs: AssistantContextRef[] = [
    { kind: 'assessment', id: assessmentId, label },
    ...(classGroupId ? [{ kind: 'classGroup' as const, id: classGroupId }] : []),
  ];

  return <RegisterAssistantContext refs={refs} />;
}
