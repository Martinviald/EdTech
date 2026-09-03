'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
import type {
  AssessCaptureIdentityModel,
  CaptureTransport,
  ScanUploadIntent,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/shared';
import { CameraCaptureSection } from '@/app/(dashboard)/hojas/escanear/CameraCaptureSection';
import { assessIdentityLabel } from '@/app/(dashboard)/hojas/escanear/capture-identity';
import {
  createCaptureTokenTransport,
  finishCaptureSession,
  redeemCaptureSession,
} from '@/lib/capture-transport';
import {
  captureContextLabel,
  captureErrorMessage,
  extractSecretFromHash,
  isSessionGone,
  type MobileCapturePhase,
} from './mobile-capture-helpers';

const SESSION_GONE_FALLBACK = 'La sesión de captura ya no está activa.';
const ASK_FOR_NEW_QR = 'Pídele un código QR nuevo a quien está en el computador.';

function putToStorage(intent: ScanUploadIntent, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(intent.method, intent.uploadUrl);
    for (const [key, value] of Object.entries(intent.headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`El almacenamiento respondió ${xhr.status} al subir la foto`));
    };
    xhr.onerror = () => reject(new Error('Fallo de red al subir la foto'));
    xhr.send(file);
  });
}

async function uploadCapture(
  transport: CaptureTransport,
  file: File,
  identity: AssessCaptureIdentityModel | null,
): Promise<void> {
  const intent = await transport.createUploadIntent({
    fileName: file.name,
    sizeBytes: file.size,
    identity,
  });
  await putToStorage(intent, file);
  await transport.confirmFile(intent.fileId, file.size);
}

export function MobileCaptureView({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<MobileCapturePhase>({ phase: 'redeeming' });
  const [capturedIdentities, setCapturedIdentities] = useState<AssessCaptureIdentityModel[]>([]);
  const [capturedCount, setCapturedCount] = useState(0);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [finishPending, setFinishPending] = useState(false);
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const redeemStartedRef = useRef(false);
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;

  useEffect(() => {
    if (redeemStartedRef.current) return;
    redeemStartedRef.current = true;
    const secret = extractSecretFromHash(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (!secret) {
      setState({
        phase: 'redeem-failed',
        message: 'El enlace está incompleto: falta el código de acceso.',
      });
      return;
    }
    redeemCaptureSession(sessionId, secret)
      .then((response) => {
        setCapturedCount(response.capturedCount);
        setState({ phase: 'capturing', token: response.token, context: response.context });
      })
      .catch((err: unknown) => {
        setState({
          phase: 'redeem-failed',
          message: captureErrorMessage(err, 'No se pudo activar la sesión de captura.'),
        });
      });
  }, [sessionId]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && phaseRef.current === 'capturing') {
        setCameraEpoch((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const token = state.phase === 'capturing' ? state.token : null;

  const transport = useMemo<CaptureTransport | null>(() => {
    if (!token) return null;
    const base = createCaptureTokenTransport(token);
    const guarded =
      <Args extends unknown[], Result>(call: (...args: Args) => Promise<Result>) =>
      async (...args: Args): Promise<Result> => {
        try {
          return await call(...args);
        } catch (err) {
          if (isSessionGone(err)) {
            setState({
              phase: 'session-gone',
              message: captureErrorMessage(err, SESSION_GONE_FALLBACK),
            });
          }
          throw err;
        }
      };
    return {
      assess: guarded(base.assess),
      createUploadIntent: guarded(base.createUploadIntent),
      confirmFile: guarded(base.confirmFile),
    };
  }, [token]);

  function handleAccepted(file: File, identity: AssessCaptureIdentityModel | null): boolean {
    if (!transport) return false;
    setUploadingCount((n) => n + 1);
    void uploadCapture(transport, file, identity)
      .then(() => {
        setCapturedCount((n) => n + 1);
        if (identity) setCapturedIdentities((prev) => [...prev, identity]);
        const label = identity ? assessIdentityLabel(identity) : null;
        toast.success(
          label
            ? `Hoja subida: ${label}.`
            : 'Hoja subida. La identidad se resolverá al procesar el lote.',
        );
      })
      .catch((err: unknown) => {
        if (!isSessionGone(err)) {
          toast.error(
            captureErrorMessage(err, 'No se pudo subir la foto. Vuelve a tomarla.'),
          );
        }
      })
      .finally(() => setUploadingCount((n) => n - 1));
    return false;
  }

  function handleFinish() {
    if (!token) return;
    setFinishPending(true);
    finishCaptureSession(token)
      .then(() => setState({ phase: 'finished' }))
      .catch((err: unknown) => {
        if (isSessionGone(err)) {
          setState({
            phase: 'session-gone',
            message: captureErrorMessage(err, SESSION_GONE_FALLBACK),
          });
          return;
        }
        toast.error(
          captureErrorMessage(err, 'No se pudo enviar el lote a procesar. Vuelve a intentarlo.'),
        );
      })
      .finally(() => setFinishPending(false));
  }

  if (state.phase === 'redeeming') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3" role="status">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">Activando la sesión de captura…</p>
      </div>
    );
  }

  if (state.phase === 'redeem-failed') {
    return (
      <div className="flex flex-1 flex-col justify-center">
        <AlertCallout tone="danger" title="No se pudo activar la captura">
          {state.message} {ASK_FOR_NEW_QR}
        </AlertCallout>
      </div>
    );
  }

  if (state.phase === 'session-gone') {
    return (
      <div className="flex flex-1 flex-col justify-center">
        <AlertCallout tone="warning" title="La sesión de captura terminó">
          {state.message} Las fotos ya subidas quedaron guardadas en el computador.{' '}
          {ASK_FOR_NEW_QR}
        </AlertCallout>
      </div>
    );
  }

  if (state.phase === 'finished') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <CheckCircle2 className="size-10 text-primary" aria-hidden />
        <div className="space-y-1">
          <p className="text-lg font-semibold text-foreground">Lote enviado a procesar</p>
          <p className="text-sm text-muted-foreground">
            Puedes cerrar esta página; el seguimiento continúa en el computador.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Captura de hojas</h1>
        <p className="text-sm text-muted-foreground">{captureContextLabel(state.context)}</p>
      </div>

      {transport && (
        <CameraCaptureSection
          key={cameraEpoch}
          transport={transport}
          expectedSheets={state.context.sheetCount > 0 ? state.context.sheetCount : null}
          capturedIdentities={capturedIdentities}
          capturedCount={capturedCount}
          onAccepted={handleAccepted}
        />
      )}

      {uploadingCount > 0 && (
        <p
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Subiendo {uploadingCount === 1 ? 'una foto' : `${uploadingCount} fotos`}…
        </p>
      )}

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={finishPending || uploadingCount > 0 || capturedCount === 0}
        onClick={handleFinish}
      >
        {finishPending ? (
          <Loader2 className="mr-2 size-5 animate-spin" aria-hidden />
        ) : (
          <Send className="mr-2 size-5" aria-hidden />
        )}
        {finishPending ? 'Enviando el lote…' : 'Terminar y procesar'}
      </Button>
    </div>
  );
}
