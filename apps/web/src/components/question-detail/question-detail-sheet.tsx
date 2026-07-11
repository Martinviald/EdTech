'use client';

// Shell compartido de los paneles laterales de detalle de pregunta (banco de
// ítems y resultados). Encapsula el andamiaje común: el `Sheet` anclado a la
// derecha, el ancho ajustable+persistente (borde arrastrable), el header
// accesible (Title + Description que Radix exige) y el visor de texto de lectura.
// Cada panel pasa su cuerpo específico como `children`.

import { useState, type JSX, type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PassageDialog, type PassageData } from '@/components/passage-dialog';
import { useResizablePanelWidth, PanelResizeHandle } from '@/hooks/use-resizable-panel-width';

export function QuestionDetailSheet(props: {
  open: boolean;
  onClose: () => void;
  /** Posición de la pregunta (para el badge y el título). Null si no hay dato. */
  position?: number | null;
  /** Badges extra junto al de "Pregunta N" (tipo de ítem, clave correcta, …). */
  headerBadges?: ReactNode;
  /** Texto de la descripción accesible del panel. */
  description: string;
  /** Pasaje de lectura ya mapeado; si viene, se muestra el botón + diálogo. */
  passage?: PassageData | null;
  /** Clave de localStorage donde persiste el ancho (una por panel). */
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  children: ReactNode;
}): JSX.Element {
  const {
    open,
    onClose,
    position,
    headerBadges,
    description,
    passage = null,
    storageKey,
    defaultWidth = 560,
    minWidth = 400,
    children,
  } = props;

  const [passageOpen, setPassageOpen] = useState(false);
  const { width, onPointerDown, onKeyDown } = useResizablePanelWidth({
    storageKey,
    defaultWidth,
    minWidth,
  });

  const hasPosition = typeof position === 'number';

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="right"
        style={{ width, maxWidth: '95vw' }}
        className="w-full max-w-none overflow-y-auto"
      >
        {/* Tirador de redimensionado en el borde izquierdo (panel ancla derecha). */}
        <PanelResizeHandle onPointerDown={onPointerDown} onKeyDown={onKeyDown} />
        {/* Header SIEMPRE presente (Radix Dialog exige Title + Description). */}
        <SheetHeader className="space-y-2 pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{hasPosition ? `Pregunta ${position}` : 'Pregunta'}</Badge>
            {headerBadges}
          </div>
          <SheetTitle className="text-base leading-snug">
            {hasPosition ? `Detalle de la pregunta ${position}` : 'Detalle de la pregunta'}
          </SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        {passage ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-4 w-full justify-start gap-2"
            onClick={() => setPassageOpen(true)}
          >
            <BookOpen className="size-4" aria-hidden />
            Ver texto de lectura
          </Button>
        ) : null}

        {children}
      </SheetContent>

      {passage ? (
        <PassageDialog open={passageOpen} onOpenChange={setPassageOpen} passage={passage} />
      ) : null}
    </Sheet>
  );
}
