'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Loader2, QrCode, RotateCcw, Smartphone, X } from 'lucide-react';
import type { CaptureSessionStatus } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/shared';
import { useCaptureSession } from '../hooks/use-capture-session';
import { assessIdentityLabel } from './capture-identity';
import { SCAN_ROUTES } from './batch-meta';
import {
  createCaptureSession,
  finishCaptureSession,
  revokeCaptureSession,
} from './capture-session-actions';

/** El secreto vive SOLO en este estado local: nunca se persiste ni se re-fetchea (CD-18). */
type LocalSession = {
  sessionId: string;
  batchId: string;
  secret: string;
  expiresAt: string | Date;
};

type RemoteCaptureSectionProps = {
  printRunId: string;
  expectedSheets: number | null;
  onCancel?: () => void;
};

function formatExpiryTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function RemoteCaptureSection({
  printRunId,
  expectedSheets,
  onCancel,
}: RemoteCaptureSectionProps) {
  const router = useRouter();
  const [session, setSession] = useState<LocalSession | null>(null);
  const [showQrAgain, setShowQrAgain] = useState(false);
  const [isPending, startTransition] = useTransition();
  const redirectedRef = useRef(false);

  const poll = useCaptureSession(session?.sessionId ?? null);
  const status: CaptureSessionStatus | null = session ? (poll.data?.status ?? 'pending') : null;
  const captures = poll.data?.captures ?? [];
  const identityLabels = captures
    .map((capture) => ({
      fileId: capture.fileId,
      label: capture.identity ? assessIdentityLabel(capture.identity) : null,
    }))
    .filter((entry): entry is { fileId: string; label: string } => entry.label !== null);
  const batchId = poll.data?.batchId ?? session?.batchId ?? null;

  useEffect(() => {
    if (status !== 'closed' || !batchId || redirectedRef.current) return;
    redirectedRef.current = true;
    toast.success('Captura terminada desde el teléfono: te llevamos al seguimiento del lote.');
    router.push(SCAN_ROUTES.revisar(batchId));
  }, [status, batchId, router]);

  function applyCreated(created: Awaited<ReturnType<typeof createCaptureSession>>) {
    if (!created.ok) {
      toast.error(created.message);
      return;
    }
    setSession({
      sessionId: created.data.sessionId,
      batchId: created.data.batchId,
      secret: created.data.secret,
      expiresAt: created.data.expiresAt,
    });
    setShowQrAgain(false);
  }

  function handleGenerate() {
    startTransition(async () => {
      applyCreated(await createCaptureSession(printRunId));
    });
  }

  function handleRegenerate() {
    const current = session;
    const revocable = status === 'pending' || status === 'active';
    startTransition(async () => {
      if (current && revocable) await revokeCaptureSession(current.sessionId);
      applyCreated(await createCaptureSession(printRunId));
    });
  }

  function handleCancel() {
    const current = session;
    const revocable = status === 'pending' || status === 'active';
    startTransition(async () => {
      if (current && revocable) await revokeCaptureSession(current.sessionId);
      setSession(null);
      onCancel?.();
    });
  }

  function handleFinish() {
    const current = session;
    if (!current) return;
    startTransition(async () => {
      const result = await finishCaptureSession(current.sessionId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      redirectedRef.current = true;
      toast.success('Lote en procesamiento: te llevamos al seguimiento.');
      router.push(SCAN_ROUTES.revisar(result.data.batchId));
    });
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border p-8 text-center">
        <Smartphone className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">Captura las hojas con tu teléfono</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Genera un código QR, escanéalo con la cámara del teléfono y toma las fotos desde ahí.
          Cada foto aceptada aparece aquí al instante y el lote se procesa al terminar.
        </p>
        <Button type="button" disabled={isPending} onClick={handleGenerate}>
          {isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          ) : (
            <QrCode className="mr-2 size-4" aria-hidden />
          )}
          Generar código QR
        </Button>
      </div>
    );
  }

  if (status === 'closed') {
    return (
      <div
        className="flex items-center justify-center gap-2 rounded-lg border p-8"
        role="status"
      >
        <CheckCircle2 className="size-5 text-success" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          Captura terminada: abriendo el seguimiento del lote…
        </p>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="space-y-3">
        <AlertCallout tone="warning" title="El código venció">
          Pasaron más de 15 minutos desde que se generó. Las fotos ya capturadas quedaron
          guardadas en el lote y puedes procesarlas desde “Lotes recientes”.
        </AlertCallout>
        <Button type="button" disabled={isPending} onClick={handleRegenerate}>
          {isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          ) : (
            <QrCode className="mr-2 size-4" aria-hidden />
          )}
          Generar uno nuevo
        </Button>
      </div>
    );
  }

  if (status === 'revoked') {
    return (
      <div className="space-y-3">
        <AlertCallout tone="info" title="El código fue revocado">
          Este código ya no sirve para emparejar un teléfono. Si quedaron fotos capturadas, el
          lote sigue disponible en “Lotes recientes”.
        </AlertCallout>
        <Button type="button" disabled={isPending} onClick={handleRegenerate}>
          {isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          ) : (
            <QrCode className="mr-2 size-4" aria-hidden />
          )}
          Generar un código nuevo
        </Button>
      </div>
    );
  }

  const active = status === 'active';
  const qrVisible = !active || showQrAgain;
  const expiresAt = poll.data?.expiresAt ?? session.expiresAt;

  return (
    <div className="space-y-4">
      {active ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground" role="status">
            {captures.length}
            {expectedSheets !== null ? ` de ${expectedSheets}` : ''} hojas capturadas
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowQrAgain((prev) => !prev)}
          >
            <QrCode className="mr-2 size-4" aria-hidden />
            {showQrAgain ? 'Ocultar código' : 'Mostrar código de nuevo'}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm font-medium text-foreground" role="status">
          Esperando el teléfono… escanea el código con la cámara.
        </p>
      )}

      {qrVisible && (
        <div className="flex flex-col items-center gap-2">
          <div className="overflow-hidden rounded-lg border">
            <QRCodeSVG
              value={`${window.location.origin}/movil/hojas/${session.sessionId}#${session.secret}`}
              size={220}
              marginSize={3}
              title="Código QR para abrir la captura de hojas en el teléfono"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            El código vence a las {formatExpiryTime(expiresAt)}.
          </p>
        </div>
      )}

      {active && identityLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {identityLabels.map(({ fileId, label }) => (
            <Badge key={fileId} variant="secondary">
              {label}
            </Badge>
          ))}
        </div>
      )}

      {active && (
        <p className="text-xs text-muted-foreground">
          Teléfono conectado: cada foto aceptada aparece aquí a medida que se captura. Cuando
          estén todas, termina para procesar el lote.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {active && (
          <Button
            type="button"
            disabled={isPending || captures.length === 0}
            onClick={handleFinish}
          >
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="mr-2 size-4" aria-hidden />
            )}
            Terminar y procesar
          </Button>
        )}
        <Button type="button" variant="outline" disabled={isPending} onClick={handleRegenerate}>
          <RotateCcw className="mr-2 size-4" aria-hidden />
          Regenerar código
        </Button>
        <Button type="button" variant="ghost" disabled={isPending} onClick={handleCancel}>
          <X className="mr-2 size-4" aria-hidden />
          Cancelar
        </Button>
      </div>
    </div>
  );
}
