'use client';

import {
  CheckCircle2,
  FileQuestion,
  Info,
  Loader2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';

export type CaptureToastTone = 'info' | 'pending' | 'success' | 'warning' | 'danger';

const TONE_ICON: Record<CaptureToastTone, LucideIcon> = {
  info: Info,
  pending: Loader2,
  success: CheckCircle2,
  warning: FileQuestion,
  danger: TriangleAlert,
};

const TONE_HSL: Record<CaptureToastTone, string> = {
  info: 'var(--sky-500)',
  pending: 'var(--neutral-300)',
  success: 'var(--emerald-600)',
  warning: 'var(--amber-500)',
  danger: 'var(--red-500)',
};

/**
 * Veredicto del control de calidad, sobre la cámara viva. No es `sonner`: estos
 * estados los gobierna la máquina de captura (uno de ellos exige una decisión del
 * usuario y no puede desaparecer solo), y tienen que quedar anclados al visor sin
 * tapar los dos cuadrados guía de abajo.
 */
export function CaptureToast({
  tone,
  title,
  children,
  actions,
  onDismiss,
}: {
  tone: CaptureToastTone;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** Cuando se pasa, el aviso trae una ✕ para cerrarlo. */
  onDismiss?: () => void;
}) {
  const Icon = TONE_ICON[tone];
  const hsl = TONE_HSL[tone];
  const color = `hsl(${hsl})`;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-xl border bg-[rgb(2_6_23_/_0.9)] px-3 py-2.5 backdrop-blur-[8px] duration-base ease-out-soft animate-in fade-in-0 motion-reduce:animate-none"
      style={{ borderColor: `hsl(${hsl} / 0.48)` }}
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden
          className={`mt-px size-5 shrink-0 ${tone === 'pending' ? 'animate-spin motion-reduce:animate-none' : ''}`}
          style={{ color }}
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-[13px] font-semibold text-[hsl(var(--neutral-0))]">{title}</p>
          <p className="text-xs leading-[17px] text-[hsl(var(--neutral-300))]">{children}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Cerrar el aviso"
            className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-[hsl(var(--neutral-400))] transition-colors duration-fast hover:text-[hsl(var(--neutral-0))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
