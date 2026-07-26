'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { AiAnalysisStatus } from '@soe/types';
import { Card, CardContent } from '@/components/ui/card';
import { useAnalysisStatus } from '../hooks/use-analysis-status';

interface AnalysisPollerProps {
  analysisId: string;
  status: Extract<AiAnalysisStatus, 'pending' | 'processing'>;
}

/**
 * Feedback de progreso mientras el análisis se genera. Reconsulta `GET /:id`
 * (vía TanStack Query, ver useAnalysisStatus) cada 3s; al pasar a
 * `completed`/`failed` refresca la página para que el Server Component
 * muestre el resultado.
 */
export function AnalysisPoller({ analysisId, status }: AnalysisPollerProps) {
  const router = useRouter();
  const { data } = useAnalysisStatus(analysisId, status);
  const currentStatus = data?.status ?? status;
  const refreshed = useRef(false);

  useEffect(() => {
    if (currentStatus !== 'completed' && currentStatus !== 'failed') return;
    if (refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [currentStatus, router]);

  return (
    <Card>
      <CardContent
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-3 py-12 text-center"
      >
        <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
        <div className="space-y-1">
          <p className="text-base font-medium text-foreground">
            Generando análisis IA…
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {currentStatus === 'pending'
              ? 'El análisis está en cola. Mantén esta página abierta; se actualizará automáticamente.'
              : 'Interpretando las métricas de la evaluación. Esto puede tomar algunos segundos.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
