'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, ImageUp, Loader2, RotateCcw } from 'lucide-react';
import type { AssessCaptureIdentityModel, CaptureTransport, PageQuality } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/shared';
import { createAuthenticatedCaptureTransport } from '@/lib/capture-transport';
import { REJECT_REASON_LABELS } from '../lotes/[batchId]/revisar/review-labels';
import { assessIdentityLabel } from './capture-identity';
import {
  fileToCapturedJpeg,
  isCameraSupported,
  useCameraCapture,
  type CapturedJpeg,
} from '../hooks/use-camera-capture';
import { useAssessCapture } from '../hooks/use-assess-capture';

type GateState =
  | { phase: 'live' }
  | { phase: 'assessing'; previewUrl: string }
  | { phase: 'rejected'; previewUrl: string; reason: string };

type CameraCaptureSectionProps = {
  expectedSheets: number | null;
  capturedIdentities: AssessCaptureIdentityModel[];
  capturedCount: number;
  onAccepted: (file: File, identity: AssessCaptureIdentityModel | null) => boolean;
  /** Bloqueo externo: deshabilita la captura mientras el contenedor tiene trabajo en curso. */
  blocked?: boolean;
  /** Avisa al contenedor cuando el control de calidad está ocupado (para bloquear el resto de la vista). */
  onBusyChange?: (busy: boolean) => void;
} & (
  | { printRunId: string; transport?: undefined }
  | { printRunId?: undefined; transport: Pick<CaptureTransport, 'assess'> }
);

function rejectionLabel(quality: PageQuality): string {
  return quality.rejectReason
    ? REJECT_REASON_LABELS[quality.rejectReason]
    : 'La foto no pasó el control de calidad';
}

export function CameraCaptureSection(props: CameraCaptureSectionProps) {
  const { expectedSheets, capturedIdentities, capturedCount, onAccepted, blocked, onBusyChange } =
    props;
  const camera = useCameraCapture();
  const assess = useAssessCapture(
    props.transport !== undefined
      ? props.transport.assess
      : createAuthenticatedCaptureTransport(props.printRunId).assess,
  );
  const [gate, setGate] = useState<GateState>({ phase: 'live' });
  const [encoding, setEncoding] = useState(false);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const capturingRef = useRef(false);
  const previewUrlRef = useRef<string | null>(null);
  const supported = isCameraSupported();

  const { start } = camera;
  useEffect(() => {
    if (supported) void start();
  }, [supported, start]);

  useEffect(() => {
    previewUrlRef.current = gate.phase === 'live' ? null : gate.previewUrl;
  }, [gate]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  function isDuplicate(identity: AssessCaptureIdentityModel): boolean {
    return capturedIdentities.some(
      (prev) =>
        (identity.printedSheetId !== null &&
          prev.printedSheetId === identity.printedSheetId &&
          prev.pageIndex === identity.pageIndex) ||
        (identity.printedSheetId === null &&
          identity.studentId !== null &&
          prev.studentId === identity.studentId),
    );
  }

  function backToLive(previewUrl: string) {
    URL.revokeObjectURL(previewUrl);
    setGate({ phase: 'live' });
  }

  function notifyAccepted(identity: AssessCaptureIdentityModel | null) {
    const label = identity ? assessIdentityLabel(identity) : null;
    if (identity && label) {
      if (isDuplicate(identity)) {
        toast.warning(
          `Esta hoja ya estaba capturada (${label}). Se agregó igual: elimínala de la lista si fue sin querer.`,
        );
      } else {
        toast.success(`Foto aceptada: ${label}.`);
      }
    } else {
      toast.success('Foto aceptada. La identidad se resolverá al procesar el lote.');
    }
  }

  function runGate(capture: CapturedJpeg) {
    const previewUrl = URL.createObjectURL(capture.blob);
    setGate({ phase: 'assessing', previewUrl });
    assess.mutate(capture.imageBase64, {
      onSuccess: (result) => {
        if (!result.accepted) {
          setGate({ phase: 'rejected', previewUrl, reason: rejectionLabel(result.quality) });
          return;
        }
        const file = new File([capture.blob], `captura-${capturedCount + 1}-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        const added = onAccepted(file, result.identity);
        if (added) notifyAccepted(result.identity);
        backToLive(previewUrl);
      },
      onError: () => backToLive(previewUrl),
    });
  }

  async function handleCapture() {
    if (capturingRef.current || locked) return;
    capturingRef.current = true;
    try {
      const capture = await camera.captureJpeg();
      if (!capture) {
        toast.error('No se pudo capturar la imagen. Intenta de nuevo.');
        return;
      }
      runGate(capture);
    } finally {
      capturingRef.current = false;
    }
  }

  async function handleFallbackFile(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    e.target.value = '';
    if (!selected) return;
    setEncoding(true);
    const capture = await fileToCapturedJpeg(selected);
    setEncoding(false);
    if (!capture) {
      toast.error('No se pudo procesar la foto. Intenta de nuevo.');
      return;
    }
    runGate(capture);
  }

  const knownIdentities = capturedIdentities
    .map((identity) => ({ identity, label: assessIdentityLabel(identity) }))
    .filter(
      (entry): entry is { identity: AssessCaptureIdentityModel; label: string } =>
        entry.label !== null,
    );
  const useFallback = !supported || camera.status === 'denied' || camera.status === 'error';
  const busy = gate.phase === 'assessing' || encoding;
  const locked = busy || blocked === true;

  const busyRef = useRef(false);
  busyRef.current = busy;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);
  useEffect(
    () => () => {
      if (busyRef.current) onBusyChangeRef.current?.(false);
    },
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground" role="status">
          {capturedCount}
          {expectedSheets !== null ? ` de ${expectedSheets}` : ''} hojas capturadas
        </p>
      </div>

      {knownIdentities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {knownIdentities.map(({ identity, label }, index) => (
            <Badge
              key={`${identity.printedSheetId ?? identity.studentId ?? 'sin-id'}-${identity.pageIndex ?? 0}-${index}`}
              variant="secondary"
            >
              {label}
            </Badge>
          ))}
        </div>
      )}

      {useFallback ? (
        <div className="space-y-3">
          <AlertCallout tone="info" title="Cámara no disponible en este navegador">
            {camera.status === 'denied'
              ? 'El permiso de cámara fue denegado. Puedes tomar la foto con la app de cámara del teléfono: cada foto pasa igual por el control de calidad.'
              : 'Este navegador no permite usar la cámara en vivo. Puedes tomar la foto con la app de cámara del teléfono: cada foto pasa igual por el control de calidad.'}
          </AlertCallout>
          {gate.phase === 'rejected' ? (
            <RejectedVerdict
              previewUrl={gate.previewUrl}
              reason={gate.reason}
              onRetake={() => backToLive(gate.previewUrl)}
            />
          ) : (
            <>
              <input
                ref={fallbackInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={handleFallbackFile}
                aria-label="Tomar foto de la hoja"
              />
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={locked}
                aria-busy={busy}
                onClick={() => fallbackInputRef.current?.click()}
              >
                {locked ? (
                  <Loader2 className="mr-2 size-5 animate-spin" aria-hidden />
                ) : (
                  <ImageUp className="mr-2 size-5" aria-hidden />
                )}
                {busy
                  ? 'Evaluando la foto…'
                  : blocked
                    ? 'Espera un momento…'
                    : 'Tomar foto de la hoja'}
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-muted sm:mx-auto sm:max-w-md">
            <video
              ref={camera.videoRef}
              autoPlay
              playsInline
              muted
              aria-label="Vista previa en vivo de la cámara para capturar la hoja"
              className="h-full w-full object-cover"
            />
            {gate.phase === 'live' && camera.status === 'active' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
                <div className="aspect-[17/22] w-full rounded-md border-2 border-primary/80" />
              </div>
            )}
            {gate.phase === 'live' && camera.status !== 'active' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
              </div>
            )}
            {gate.phase !== 'live' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={gate.previewUrl}
                alt="Foto capturada de la hoja"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {gate.phase === 'assessing' && (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-background/90 p-3">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                <span className="text-sm font-medium text-foreground">Evaluando calidad…</span>
              </div>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Encuadra la hoja completa dentro del marco, plana y sin reflejos.
          </p>

          {gate.phase === 'rejected' ? (
            <RejectedVerdict reason={gate.reason} onRetake={() => backToLive(gate.previewUrl)} />
          ) : (
            <Button
              type="button"
              size="lg"
              className="w-full sm:mx-auto sm:flex sm:max-w-md"
              disabled={locked || camera.status !== 'active'}
              aria-busy={busy}
              onClick={handleCapture}
            >
              {locked ? (
                <Loader2 className="mr-2 size-5 animate-spin" aria-hidden />
              ) : (
                <Camera className="mr-2 size-5" aria-hidden />
              )}
              {busy ? 'Evaluando la foto…' : blocked ? 'Espera un momento…' : 'Capturar hoja'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function RejectedVerdict({
  previewUrl,
  reason,
  onRetake,
}: {
  previewUrl?: string;
  reason: string;
  onRetake: () => void;
}) {
  return (
    <div className="space-y-3">
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Foto capturada de la hoja"
          className="mx-auto max-h-64 rounded-lg border object-contain"
        />
      )}
      <AlertCallout tone="danger" title="Foto rechazada: no entra al lote">
        {reason}. Vuelve a tomarla con la hoja completa, plana y bien iluminada.
      </AlertCallout>
      <Button type="button" size="lg" variant="outline" className="w-full" onClick={onRetake}>
        <RotateCcw className="mr-2 size-5" aria-hidden />
        Repetir foto
      </Button>
    </div>
  );
}
