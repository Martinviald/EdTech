'use client';

import { Check, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { SheetRow } from './capture-sheets';

function StatusIcon({ status }: { status: SheetRow['status'] }) {
  if (status === 'uploading') {
    return (
      <Loader2
        className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  if (status === 'failed') return null;
  return <Check className="size-4 shrink-0 text-[hsl(var(--emerald-600))]" aria-hidden />;
}

const STATUS_LABEL: Record<SheetRow['status'], string> = {
  uploading: 'Subiendo…',
  done: 'Aceptada · calidad verificada',
  failed: 'No se pudo subir',
};

export function CapturedSheetsSheet({
  open,
  onOpenChange,
  rows,
  priorCount,
  capturedCount,
  expectedSheets,
  contextLabel,
  finishPending,
  finishDisabled,
  onFinish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: SheetRow[];
  priorCount: number;
  capturedCount: number;
  expectedSheets: number | null;
  contextLabel: string;
  finishPending: boolean;
  finishDisabled: boolean;
  onFinish: () => void;
}) {
  const title = capturedCount === 1 ? '1 hoja capturada' : `${capturedCount} hojas capturadas`;
  const progress =
    expectedSheets !== null ? `${capturedCount} de ${expectedSheets}` : `${capturedCount}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[70%] flex-col gap-0 rounded-t-[24px] border-t-0 bg-card p-0 shadow-[0_-12px_40px_rgb(2_6_23_/_0.4)] [&>button:last-of-type]:right-4 [&>button:last-of-type]:top-3 [&>button:last-of-type]:flex [&>button:last-of-type]:size-9 [&>button:last-of-type]:items-center [&>button:last-of-type]:justify-center [&>button:last-of-type]:rounded-full [&>button:last-of-type]:border [&>button:last-of-type]:border-border [&>button:last-of-type]:opacity-100"
      >
        <SheetHeader className="space-y-1 border-b border-border px-5 pb-3 pt-3.5 text-left">
          <SheetTitle className="text-base font-semibold tracking-[-0.01em]">{title}</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {contextLabel} · <span className="tabular-nums">{progress}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {rows.length === 0 && priorCount === 0 ? (
            <p className="px-2 py-6 text-[13px] leading-[19px] text-muted-foreground">
              Aún no hay hojas capturadas. La primera aparece aquí en cuanto pasa el control de
              calidad.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {priorCount > 0 && (
                <li className="flex items-center gap-3 rounded-[10px] px-2 py-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-xs font-semibold tabular-nums text-secondary-foreground">
                    {priorCount}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">
                    {priorCount === 1 ? 'Una hoja capturada' : `${priorCount} hojas capturadas`}{' '}
                    antes de abrir esta sesión
                  </span>
                </li>
              )}
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-3 rounded-[10px] px-2 py-2.5 hover:bg-muted"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-xs font-semibold tabular-nums text-secondary-foreground">
                    {row.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {row.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {STATUS_LABEL[row.status]}
                    </span>
                  </span>
                  <StatusIcon status={row.status} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1 border-t border-border px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={finishDisabled}
            aria-busy={finishPending}
            onClick={onFinish}
          >
            {finishPending ? (
              <Loader2
                className="mr-2 size-5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Send className="mr-2 size-5" aria-hidden />
            )}
            {finishPending ? 'Enviando el lote…' : 'Terminar y procesar el lote'}
          </Button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="min-h-11 w-full rounded-lg text-[13px] font-medium text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]"
          >
            Seguir capturando
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
