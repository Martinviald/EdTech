'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { RemedialStatus } from '@soe/types';
import { Card, CardContent } from '@/components/ui/card';
import { pollRemedialStatus } from '../actions';

const POLL_INTERVAL_MS = 3000;
/** Corte de seguridad: deja de reconsultar tras este número de intentos. */
const MAX_ATTEMPTS = 100;

interface RemedialPollerProps {
  materialId: string;
  status: Extract<RemedialStatus, 'pending' | 'processing'>;
}

/**
 * Feedback de progreso mientras el material se genera. Reconsulta
 * `GET /remedial/:id` (vía server action) cada 3s; al salir de `pending`/
 * `processing` refresca la página para que el Server Component muestre el
 * resultado. Corta el polling al desmontar o tras `MAX_ATTEMPTS`.
 */
export function RemedialPoller({ materialId, status }: RemedialPollerProps) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<RemedialStatus>(status);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let attempts = 0;
    let timer = window.setTimeout(tick, POLL_INTERVAL_MS);

    async function tick() {
      attempts += 1;
      try {
        const { status: next } = await pollRemedialStatus(materialId);
        if (stopped.current) return;
        setCurrentStatus(next);
        if (next !== 'pending' && next !== 'processing') {
          router.refresh();
          return;
        }
      } catch {
        // Error transitorio de red: reintenta en el siguiente intervalo.
      }
      if (!stopped.current && attempts < MAX_ATTEMPTS) {
        timer = window.setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    return () => {
      stopped.current = true;
      window.clearTimeout(timer);
    };
  }, [materialId, router]);

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
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
