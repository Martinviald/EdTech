'use client';

import { useEffect, useState, type JSX } from 'react';
import { ImageIcon, ImageOff, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ─────────────────────────────────────────────────────────────────────────────
// Modal que muestra la FIGURA de un ítem: la banda recortada del PDF original
// con el enunciado gráfico y/o las alternativas-imagen. Sin ella, muchos ítems
// ("¿Qué número está representado?") son texto imposible de responder.
//
// La imagen se pide a `/items/{itemId}/figura`, una ruta estable que responde 302
// hacia una presigned recién firmada. Por eso el `src` no caduca aunque el panel
// lleve horas abierto.
//
// Como es un Dialog (Radix, portal a body) se monta por encima de los `Sheet`
// laterales, que son `z-50`; de ahí el `z-[60]` del content —igual que
// `passage-dialog.tsx`—.
// ─────────────────────────────────────────────────────────────────────────────

export function ItemFigureDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  /** Posición de la pregunta, sólo para el texto accesible. */
  position?: number | null;
}): JSX.Element {
  const { open, onOpenChange, itemId, position } = props;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Cada apertura vuelve a pedir la imagen (el 302 se re-firma), así que el
  // estado de carga se reinicia; si cambia el ítem, también.
  useEffect(() => {
    if (open) setStatus('loading');
  }, [open, itemId]);

  const label =
    typeof position === 'number' ? `Figura de la pregunta ${position}` : 'Figura de la pregunta';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-base leading-snug">
            <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {label}
          </DialogTitle>
          <DialogDescription>
            Imagen original de la pregunta tal como aparece en la prueba.
          </DialogDescription>
        </DialogHeader>

        {status === 'loading' ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" aria-hidden />
            <p className="text-sm">Cargando la figura…</p>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
            <ImageOff className="size-4 shrink-0" aria-hidden />
            <span>La figura no está disponible en este momento.</span>
          </div>
        ) : null}

        {/* Se monta siempre (salvo error) para que el navegador dispare la carga;
            queda oculto mientras `status` es 'loading'. */}
        {status !== 'error' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/items/${itemId}/figura`}
            alt={label}
            className={status === 'ready' ? 'w-full rounded-md border object-contain' : 'hidden'}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('error')}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
