'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, X } from 'lucide-react';
import type { UserRole } from '@soe/types';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/patterns';
import { generateAssessmentAnalysis } from '../actions';

interface ReportActionsProps {
  assessmentId: string;
  classGroupId?: string;
  activeRole: UserRole;
  /** Ruta base a la que redirigir (hub o top-level). Por defecto `/analisis-ia`. */
  basePath?: string;
}

/**
 * Acciones del informe (H20.7): Regenerar fuerza un nuevo análisis ignorando la
 * caché (`force:true`); Descartar cierra el informe volviendo al estado previo
 * (limpia `analysisId` de la URL) sin borrar el registro.
 */
export function ReportActions({
  assessmentId,
  classGroupId,
  activeRole,
  basePath = '/analisis-ia',
}: ReportActionsProps) {
  const router = useRouter();
  const [isRegenerating, startRegenerate] = useTransition();
  const [isDiscarding, startDiscard] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRegenerate() {
    setError(null);
    startRegenerate(async () => {
      try {
        const { analysisId } = await generateAssessmentAnalysis({
          assessmentId,
          classGroupId,
          audience: activeRole === 'teacher' ? 'teacher' : 'director',
          force: true,
        });
        const query = new URLSearchParams();
        query.set('assessmentId', assessmentId);
        query.set('analysisId', analysisId);
        if (classGroupId) query.set('classGroupId', classGroupId);
        router.replace(`${basePath}?${query.toString()}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo regenerar el análisis.');
      }
    });
  }

  function handleDiscard() {
    startDiscard(() => {
      const query = new URLSearchParams();
      query.set('assessmentId', assessmentId);
      if (classGroupId) query.set('classGroupId', classGroupId);
      router.replace(`${basePath}?${query.toString()}`);
      router.refresh();
    });
  }

  const busy = isRegenerating || isDiscarding;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={handleRegenerate} disabled={busy}>
          {isRegenerating ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          Regenerar
        </Button>
        <Button variant="secondary" onClick={handleDiscard} disabled={busy}>
          {isDiscarding ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <X className="size-4" aria-hidden />
          )}
          Descartar
        </Button>
      </div>
      {error ? <AlertCallout tone="danger">{error}</AlertCallout> : null}
    </div>
  );
}
