'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronUp, ImageUp, Loader2, ScanLine, Send } from 'lucide-react';
import type { AssessCaptureIdentityModel, CaptureTransport, PageQuality } from '@soe/types';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/shared';
import {
  MARKS_READABILITY_LABELS,
  REJECT_REASON_LABELS,
} from '@/app/(dashboard)/hojas/lotes/[batchId]/revisar/review-labels';
import { assessIdentityLabel } from '@/app/(dashboard)/hojas/escanear/capture-identity';
import {
  CLEAR_SURFACE_REASON,
  CLEAR_SURFACE_TIP,
  rejectionHint,
} from '@/app/(dashboard)/hojas/escanear/capture-hints';
import {
  fileToCapturedJpeg,
  isCameraSupported,
  useCameraCapture,
  type CapturedJpeg,
} from '@/app/(dashboard)/hojas/hooks/use-camera-capture';
import { useAssessCapture } from '@/app/(dashboard)/hojas/hooks/use-assess-capture';
import { CaptureToast } from './CaptureToast';
import { CaptureViewfinder } from './CaptureViewfinder';
import { CapturedSheetsSheet } from './CapturedSheetsSheet';
import {
  countCaptured,
  isDuplicateIdentity,
  toSheetRows,
  type CapturedSheet,
} from './capture-sheets';

/**
 * El veredicto se muestra sobre la cámara viva: no se congela el frame ni se navega
 * a una pantalla intermedia, porque un lote son cientos de hojas seguidas.
 */
type GateState =
  | { phase: 'live' }
  | { phase: 'assessing'; sheetNumber: number }
  | { phase: 'rejected'; reason: string; hint: string }
  | { phase: 'uploaded'; label: string | null }
  | {
      phase: 'blank-confirm';
      blob: Blob;
      identity: AssessCaptureIdentityModel | null;
    };

type MobileCameraCaptureProps = {
  transport: Pick<CaptureTransport, 'assess'>;
  contextLabel: string;
  expectedSheets: number | null;
  priorCount: number;
  sheets: CapturedSheet[];
  finishPending: boolean;
  onAccepted: (file: File, identity: AssessCaptureIdentityModel | null) => void;
  onFinish: () => void;
};

function rejectionLabel(quality: PageQuality): string {
  if (quality.rejectReason === 'no_separable_marks' && quality.marksReadability === 'unreadable') {
    return MARKS_READABILITY_LABELS.unreadable;
  }
  return quality.rejectReason
    ? REJECT_REASON_LABELS[quality.rejectReason]
    : 'La foto no pasó el control de calidad';
}

function looksBlank(quality: PageQuality): boolean {
  return (
    quality.rejectReason === 'no_separable_marks' && quality.marksReadability === 'likely_blank'
  );
}

export function MobileCameraCapture({
  transport,
  contextLabel,
  expectedSheets,
  priorCount,
  sheets,
  finishPending,
  onAccepted,
  onFinish,
}: MobileCameraCaptureProps) {
  const camera = useCameraCapture();
  const assess = useAssessCapture(transport.assess);
  const [gate, setGate] = useState<GateState>({ phase: 'live' });
  const [encoding, setEncoding] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const capturingRef = useRef(false);
  const supported = isCameraSupported();

  const capturedCount = countCaptured(sheets, priorCount);
  const rows = useMemo(() => toSheetRows(sheets, priorCount), [sheets, priorCount]);
  const uploading = sheets.some((sheet) => sheet.status === 'uploading');

  const { start } = camera;
  useEffect(() => {
    if (supported) void start();
  }, [supported, start]);

  // El aviso de «subiendo» se apaga solo: la subida corre en segundo plano y el
  // obturador ya está libre, así que no debe quedar tapando la guía en vivo.
  useEffect(() => {
    if (gate.phase !== 'uploaded') return;
    const timer = window.setTimeout(() => setGate({ phase: 'live' }), 2600);
    return () => window.clearTimeout(timer);
  }, [gate]);

  // El control de calidad es lo único que bloquea el obturador. La subida corre en
  // segundo plano a propósito: es lo que permite encadenar cientos de hojas.
  const gateBusy = gate.phase === 'assessing' || encoding;
  const busyForProgress = gateBusy || uploading || finishPending;
  const finishDisabled = finishPending || uploading || gateBusy || capturedCount === 0;

  function upload(blob: Blob, identity: AssessCaptureIdentityModel | null) {
    const file = new File([blob], `captura-${capturedCount + 1}-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });
    const label = identity ? assessIdentityLabel(identity) : null;
    if (identity && isDuplicateIdentity(identity, sheets)) {
      toast.warning(
        `Esta hoja ya estaba capturada${label ? ` (${label})` : ''}. Se agregó igual: elimínala de la lista en el computador si fue sin querer.`,
      );
    }
    onAccepted(file, identity);
    setGate({ phase: 'uploaded', label });
  }

  function runGate(capture: CapturedJpeg) {
    setGate({ phase: 'assessing', sheetNumber: capturedCount + 1 });
    assess.mutate(capture.imageBase64, {
      onSuccess: (result) => {
        if (!result.accepted && looksBlank(result.quality)) {
          setGate({ phase: 'blank-confirm', blob: capture.blob, identity: result.identity });
          return;
        }
        if (!result.accepted) {
          setGate({
            phase: 'rejected',
            reason: rejectionLabel(result.quality),
            hint: rejectionHint(result.quality.rejectReason),
          });
          return;
        }
        upload(capture.blob, result.identity);
      },
      onError: () => setGate({ phase: 'live' }),
    });
  }

  async function handleCapture() {
    if (capturingRef.current || gateBusy) return;
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

  const useFallback = !supported || camera.status === 'denied' || camera.status === 'error';

  if (useFallback) {
    return (
      <FallbackCapture
        cameraDenied={camera.status === 'denied'}
        gate={gate}
        busy={gateBusy}
        capturedCount={capturedCount}
        expectedSheets={expectedSheets}
        contextLabel={contextLabel}
        finishDisabled={finishDisabled}
        finishPending={finishPending}
        inputRef={fallbackInputRef}
        onFallbackFile={handleFallbackFile}
        onRetake={() => setGate({ phase: 'live' })}
        onUploadAnyway={() => {
          if (gate.phase === 'blank-confirm') upload(gate.blob, gate.identity);
        }}
        onFinish={onFinish}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative z-sticky shrink-0 border-b border-white/[0.08] bg-[rgb(2_6_23_/_0.72)] px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.875rem)] backdrop-blur-[12px]">
        {busyForProgress && (
          <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] overflow-hidden">
            <span className="block h-full w-[30%] animate-progress-indeterminate bg-[hsl(var(--brand-400))] motion-reduce:animate-none motion-reduce:w-full" />
          </span>
        )}
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="truncate text-sm font-semibold tracking-[-0.01em] text-[hsl(var(--neutral-0))]">
              {contextLabel}
            </p>
            <p className="text-[11px] leading-[14px] text-[hsl(var(--neutral-400))]">
              Sesión de captura activa
            </p>
          </div>
          <CounterChip
            capturedCount={capturedCount}
            expectedSheets={expectedSheets}
            onClick={() => setSheetOpen(true)}
          />
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[hsl(var(--neutral-950))]">
        <video
          ref={camera.videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Vista previa en vivo de la cámara para capturar la hoja"
          className="size-full object-cover"
        />

        {camera.status === 'active' ? (
          <CaptureViewfinder />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2
              className="size-6 animate-spin text-[hsl(var(--neutral-400))] motion-reduce:animate-none"
              aria-hidden
            />
          </div>
        )}

        {/* Franja flotante: deja libres las esquinas para no tapar los cuadrados guía. */}
        <div className="pointer-events-none absolute inset-x-11 bottom-2.5 [&_button]:pointer-events-auto">
          <Verdict
            gate={gate}
            capturedCount={capturedCount}
            onRetake={() => setGate({ phase: 'live' })}
            onUploadAnyway={() => {
              if (gate.phase === 'blank-confirm') upload(gate.blob, gate.identity);
            }}
          />
        </div>
      </div>

      <footer className="shrink-0 border-t border-white/[0.08] bg-[rgb(2_6_23_/_0.92)] px-4 pb-[calc(env(safe-area-inset-bottom)+0.875rem)] pt-3">
        <div className="flex items-center justify-between">
          <ThumbnailButton capturedCount={capturedCount} onClick={() => setSheetOpen(true)} />
          <ShutterButton
            disabled={gateBusy || camera.status !== 'active'}
            busy={gateBusy}
            onClick={handleCapture}
          />
          <FinishButton disabled={finishDisabled} busy={finishPending} onClick={onFinish} />
        </div>
      </footer>

      <CapturedSheetsSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        rows={rows}
        priorCount={priorCount}
        capturedCount={capturedCount}
        expectedSheets={expectedSheets}
        contextLabel={contextLabel}
        finishPending={finishPending}
        finishDisabled={finishDisabled}
        onFinish={onFinish}
      />
    </div>
  );
}

function CounterChip({
  capturedCount,
  expectedSheets,
  onClick,
}: {
  capturedCount: number;
  expectedSheets: number | null;
  onClick: () => void;
}) {
  const pct =
    expectedSheets !== null && expectedSheets > 0
      ? Math.min(100, Math.round((capturedCount / expectedSheets) * 100))
      : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Ver las hojas capturadas"
      className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-white/[0.16] bg-white/[0.08] py-2 pl-3.5 pr-2.5 transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]"
    >
      <span className="flex flex-col items-start gap-1">
        <span className="text-[13px] font-semibold tabular-nums leading-none text-[hsl(var(--neutral-0))]">
          {expectedSheets !== null
            ? `${capturedCount} de ${expectedSheets}`
            : `${capturedCount} ${capturedCount === 1 ? 'hoja' : 'hojas'}`}
        </span>
        {pct !== null && (
          <span aria-hidden className="block h-[3px] w-14 overflow-hidden rounded-full bg-white/20">
            <span
              className="block h-full rounded-full bg-[hsl(var(--brand-400))] transition-[width] duration-base ease-out-soft"
              style={{ width: `${pct}%` }}
            />
          </span>
        )}
      </span>
      <ChevronUp className="size-4 shrink-0 text-[hsl(var(--neutral-300))]" aria-hidden />
    </button>
  );
}

function ThumbnailButton({
  capturedCount,
  onClick,
}: {
  capturedCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Ver las hojas capturadas"
      className="relative size-[52px] shrink-0 rounded-xl border border-white/[0.18] bg-[hsl(var(--neutral-800))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]"
    >
      <ScanLine className="mx-auto size-6 text-[hsl(var(--neutral-400))]" aria-hidden />
      {capturedCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 py-0.5 text-[10px] font-bold tabular-nums text-primary-foreground">
          {capturedCount}
        </span>
      )}
    </button>
  );
}

function ShutterButton({
  disabled,
  busy,
  onClick,
}: {
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      aria-label={busy ? 'Evaluando la calidad de la foto' : 'Capturar hoja'}
      className="flex size-[78px] shrink-0 items-center justify-center rounded-full border-4 border-white/90 bg-primary text-primary-foreground shadow-[0_0_0_6px_rgb(36_99_235_/_0.18)] transition-transform duration-base ease-out-soft active:translate-y-px disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] motion-reduce:transition-none"
    >
      {busy ? (
        <Loader2 className="size-[30px] animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <ScanLine className="size-[30px]" aria-hidden />
      )}
    </button>
  );
}

function FinishButton({
  disabled,
  busy,
  onClick,
}: {
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      className="flex w-[52px] shrink-0 flex-col items-center gap-1 disabled:opacity-45 focus-visible:outline-none [&:focus-visible>span:first-child]:outline [&:focus-visible>span:first-child]:outline-2 [&:focus-visible>span:first-child]:outline-offset-2 [&:focus-visible>span:first-child]:outline-[hsl(var(--ring))]"
    >
      <span className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-white/[0.08]">
        {busy ? (
          <Loader2
            className="size-[18px] animate-spin text-[hsl(var(--neutral-0))] motion-reduce:animate-none"
            aria-hidden
          />
        ) : (
          <Send className="size-[18px] text-[hsl(var(--neutral-0))]" aria-hidden />
        )}
      </span>
      <span className="text-[10px] font-semibold text-[hsl(var(--neutral-300))]">Terminar</span>
    </button>
  );
}

function Verdict({
  gate,
  capturedCount,
  onRetake,
  onUploadAnyway,
}: {
  gate: GateState;
  capturedCount: number;
  onRetake: () => void;
  onUploadAnyway: () => void;
}) {
  if (gate.phase === 'assessing') {
    return (
      <CaptureToast tone="pending" title={`Evaluando calidad de la hoja ${gate.sheetNumber}…`}>
        Toma un segundo. Puedes ir posicionando la hoja siguiente.
      </CaptureToast>
    );
  }

  if (gate.phase === 'rejected') {
    return (
      <CaptureToast tone="danger" title="Foto rechazada: no entra al lote">
        {gate.reason}. {gate.hint}
      </CaptureToast>
    );
  }

  if (gate.phase === 'blank-confirm') {
    return (
      <CaptureToast
        tone="warning"
        title="Esta hoja parece no tener respuestas marcadas"
        actions={
          <>
            <Button type="button" size="lg" className="flex-1" onClick={onUploadAnyway}>
              Subir igual
            </Button>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="flex-1"
              onClick={onRetake}
            >
              Repetir foto
            </Button>
          </>
        }
      >
        Súbela igual si no respondió: queda para revisión en el computador.
      </CaptureToast>
    );
  }

  if (gate.phase === 'uploaded') {
    return (
      <CaptureToast tone="success" title={gate.label ?? 'Hoja aceptada'}>
        Subiendo en segundo plano · puedes seguir capturando.
      </CaptureToast>
    );
  }

  if (capturedCount === 0) {
    return (
      <CaptureToast tone="info" title="Antes de la primera foto">
        {CLEAR_SURFACE_TIP} {CLEAR_SURFACE_REASON}
      </CaptureToast>
    );
  }

  return (
    <p className="mx-auto w-fit rounded-full bg-[rgb(2_6_23_/_0.72)] px-3 py-1.5 text-center text-xs font-medium text-[hsl(var(--neutral-100))] backdrop-blur-[8px]">
      Calza los cuadrados negros en las esquinas
    </p>
  );
}

/**
 * Respaldo para cuando no hay cámara en vivo (permiso denegado o navegador sin
 * getUserMedia): se usa la app de cámara del teléfono. Mantiene la presentación clara
 * previa al rediseño porque sin visor no hay nada que encuadrar.
 */
function FallbackCapture({
  cameraDenied,
  gate,
  busy,
  capturedCount,
  expectedSheets,
  contextLabel,
  finishDisabled,
  finishPending,
  inputRef,
  onFallbackFile,
  onRetake,
  onUploadAnyway,
  onFinish,
}: {
  cameraDenied: boolean;
  gate: GateState;
  busy: boolean;
  capturedCount: number;
  expectedSheets: number | null;
  contextLabel: string;
  finishDisabled: boolean;
  finishPending: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFallbackFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRetake: () => void;
  onUploadAnyway: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1.5rem)] text-foreground">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Captura de hojas</h1>
        <p className="text-sm text-muted-foreground">{contextLabel}</p>
      </div>

      <p className="text-sm font-medium tabular-nums text-foreground" role="status">
        {capturedCount}
        {expectedSheets !== null ? ` de ${expectedSheets}` : ''} hojas capturadas
      </p>

      <AlertCallout tone="info" title="Cámara no disponible en este navegador">
        {cameraDenied
          ? 'El permiso de cámara fue denegado. Puedes tomar la foto con la app de cámara del teléfono: cada foto pasa igual por el control de calidad.'
          : 'Este navegador no permite usar la cámara en vivo. Puedes tomar la foto con la app de cámara del teléfono: cada foto pasa igual por el control de calidad.'}
      </AlertCallout>

      {gate.phase === 'rejected' && (
        <AlertCallout tone="danger" title="Foto rechazada: no entra al lote">
          {gate.reason}. {gate.hint}
        </AlertCallout>
      )}

      {gate.phase === 'blank-confirm' ? (
        <div className="space-y-3">
          <AlertCallout tone="warning" title="Esta hoja parece no tener respuestas marcadas">
            Súbela igual si no respondió: queda para revisión en el computador.
          </AlertCallout>
          <div className="flex gap-2">
            <Button type="button" size="lg" className="flex-1" onClick={onUploadAnyway}>
              Subir igual
            </Button>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="flex-1"
              onClick={onRetake}
            >
              Repetir foto
            </Button>
          </div>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={onFallbackFile}
            aria-label="Tomar foto de la hoja"
          />
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={busy}
            aria-busy={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="mr-2 size-5 animate-spin" aria-hidden />
            ) : (
              <ImageUp className="mr-2 size-5" aria-hidden />
            )}
            {busy ? 'Evaluando la foto…' : 'Tomar foto de la hoja'}
          </Button>
        </>
      )}

      <div className="mt-auto pt-2">
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={finishDisabled}
          aria-busy={finishPending}
          onClick={onFinish}
        >
          {finishPending ? (
            <Loader2 className="mr-2 size-5 animate-spin" aria-hidden />
          ) : (
            <Send className="mr-2 size-5" aria-hidden />
          )}
          {finishPending ? 'Enviando el lote…' : 'Terminar y procesar'}
        </Button>
      </div>
    </div>
  );
}
