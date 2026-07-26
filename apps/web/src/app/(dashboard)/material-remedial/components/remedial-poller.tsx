'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { RemedialStatus } from '@soe/types';
import { Card, CardContent } from '@/components/ui/card';
import { useRemedialStatus } from '../hooks/use-remedial-status';

interface RemedialPollerProps {
  materialId: string;
  status: Extract<RemedialStatus, 'pending' | 'processing'>;
}

/**
 * Feedback de progreso mientras el material se genera. Reconsulta
 * `GET /remedial/:id` (vía TanStack Query, ver useRemedialStatus) cada 3s; al
 * salir de `pending`/`processing` refresca la página para que el Server
 * Component muestre el resultado.
 */
export function RemedialPoller({ materialId, status }: RemedialPollerProps) {
  const router = useRouter();
  const { data } = useRemedialStatus(materialId, status);
  const currentStatus = data?.status ?? status;
  const refreshed = useRef(false);

  useEffect(() => {
    if (currentStatus === 'pending' || currentStatus === 'processing') return;
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
          <p className="text-base font-medium text-foreground">Generando material remedial…</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {currentStatus === 'pending'
              ? 'El material está en cola. Mantén esta página abierta; se actualizará automáticamente.'
              : 'Construyendo el material a partir del contexto curricular. Esto puede tomar algunos segundos.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
