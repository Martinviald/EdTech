'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { AiAnalysisStatus } from '@soe/types';
import { Card, CardContent } from '@/components/ui/card';
import { pollAnalysisStatus } from '../actions';

const POLL_INTERVAL_MS = 3000;

interface AnalysisPollerProps {
  analysisId: string;
  status: Extract<AiAnalysisStatus, 'pending' | 'processing'>;
}

/**
 * Feedback de progreso mientras el análisis se genera. Reconsulta `GET /:id`
 * (vía server action) cada 3s; al pasar a `completed`/`failed` refresca la
 * página para que el Server Component muestre el resultado.
 */
export function AnalysisPoller({ analysisId, status }: AnalysisPollerProps) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<AiAnalysisStatus>(status);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;

    async function tick() {
      try {
        const { status: next } = await pollAnalysisStatus(analysisId);
        if (stopped.current) return;
        setCurrentStatus(next);
        if (next === 'completed' || next === 'failed') {
          router.refresh();
          return;
        }
      } catch {
        // Error transitorio de red: reintenta en el siguiente intervalo.
      }
      if (!stopped.current) {
        timer = window.setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    let timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      stopped.current = true;
      window.clearTimeout(timer);
    };
  }, [analysisId, router]);

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
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
