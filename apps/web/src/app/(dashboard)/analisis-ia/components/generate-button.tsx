'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/patterns';
import { generateAssessmentAnalysis } from '../actions';

interface GenerateButtonProps {
  assessmentId: string;
  classGroupId?: string;
  audience?: 'general' | 'director' | 'teacher';
  /** Ignora la caché por input_hash (regenerar / reintentar). */
  force?: boolean;
  label?: string;
  variant?: 'default' | 'outline' | 'secondary';
}

/**
 * Botón que gatilla la generación del análisis IA. Tras crear el registro,
 * redirige a `?analysisId=` para que la página entre en modo polling.
 */
export function GenerateButton({
  assessmentId,
  classGroupId,
  audience,
  force = false,
  label,
  variant = 'default',
}: GenerateButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const { analysisId } = await generateAssessmentAnalysis({
          assessmentId,
          classGroupId,
          audience,
          force,
        });
        const query = new URLSearchParams();
        query.set('assessmentId', assessmentId);
        query.set('analysisId', analysisId);
        if (classGroupId) query.set('classGroupId', classGroupId);
        router.replace(`/analisis-ia?${query.toString()}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo generar el análisis.');
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={handleClick} disabled={isPending} variant={variant}>
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="size-4" aria-hidden />
        )}
        {label ?? 'Generar análisis'}
      </Button>
      {error ? (
        <AlertCallout tone="danger" className="text-left">
          {error}
        </AlertCallout>
      ) : null}
    </div>
  );
}
