'use client';

// Shell compartido de los paneles laterales de detalle de pregunta (banco de
// ítems y resultados). Encapsula el andamiaje común: el `Sheet` anclado a la
// derecha, el ancho ajustable+persistente (borde arrastrable), el header
// accesible (Title + Description que Radix exige) y el visor de texto de lectura.
// Cada panel pasa su cuerpo específico como `children`.

import { useState, type JSX, type ReactNode } from 'react';
import { BookOpen, ImageIcon, Maximize2, Minimize2 } from 'lucide-react';
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
import { ItemFigureDialog } from '@/components/item-figure-dialog';
import { useResizablePanelWidth, PanelResizeHandle } from '@/hooks/use-resizable-panel-width';
import { cn } from '@/lib/utils';

export function QuestionDetailSheet(props: {
  open: boolean;
  onClose: () => void;
  /** Posición de la pregunta (para el badge y el título). Null si no hay dato. */
  position?: number | null;
  /** Badges extra junto al de "Pregunta N" (tipo de ítem, clave correcta, …). */
  headerBadges?: ReactNode;
  /** Acciones del header (kebab "Agregar a colección", …), alineadas a la derecha. */
  headerActions?: ReactNode;
  /** Texto de la descripción accesible del panel. */
  description: string;
  /** Pasaje de lectura ya mapeado; si viene, se muestra el botón + diálogo. */
  passage?: PassageData | null;
  /**
   * Id del ítem cuya figura se puede ver; si viene, se muestra el botón + diálogo.
   * Null/undefined cuando la pregunta no tiene figura asociada.
   */
  figureItemId?: string | null;
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
    headerActions,
    description,
    passage = null,
    figureItemId = null,
    storageKey,
    defaultWidth = 560,
    minWidth = 400,
    children,
  } = props;

  const [passageOpen, setPassageOpen] = useState(false);
  const [figureOpen, setFigureOpen] = useState(false);
  // Modo pantalla completa: expande el MISMO panel (no remonta el cuerpo), así el
  // análisis IA ya generado se conserva al maximizar/minimizar.
  const [maximized, setMaximized] = useState(false);
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
        style={maximized ? { width: '100vw', maxWidth: '100vw' } : { width, maxWidth: '95vw' }}
        className={cn('w-full max-w-none overflow-y-auto', maximized && 'sm:max-w-none')}
      >
        {/* Tirador de redimensionado en el borde izquierdo (oculto en pantalla completa). */}
        {maximized ? null : (
          <PanelResizeHandle onPointerDown={onPointerDown} onKeyDown={onKeyDown} />
        )}
        {/* Header SIEMPRE presente (Radix Dialog exige Title + Description). */}
        <SheetHeader className="space-y-2 pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{hasPosition ? `Pregunta ${position}` : 'Pregunta'}</Badge>
            {headerBadges}
            <div className="ml-auto flex items-center gap-1">
              {headerActions}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMaximized((v) => !v)}
                aria-label={maximized ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
                title={maximized ? 'Salir de pantalla completa' : 'Ver en pantalla completa'}
              >
                {maximized ? (
                  <Minimize2 className="size-4" aria-hidden />
                ) : (
                  <Maximize2 className="size-4" aria-hidden />
                )}
              </Button>
            </div>
          </div>
          <SheetTitle className="text-base leading-snug">
            {hasPosition ? `Detalle de la pregunta ${position}` : 'Detalle de la pregunta'}
          </SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        {passage || figureItemId ? (
          <div className="mt-4 flex flex-col gap-2">
            {passage ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => setPassageOpen(true)}
              >
                <BookOpen className="size-4" aria-hidden />
                Ver texto de lectura
              </Button>
            ) : null}

            {figureItemId ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => setFigureOpen(true)}
              >
                <ImageIcon className="size-4" aria-hidden />
                Ver imagen
              </Button>
            ) : null}
          </div>
        ) : null}

        {maximized ? <div className="mx-auto w-full max-w-4xl">{children}</div> : children}
      </SheetContent>

      {/* Los diálogos van FUERA del SheetContent: son portales de Radix que deben
          montarse por encima del panel, no dentro de su stacking context. */}
      {passage ? (
        <PassageDialog open={passageOpen} onOpenChange={setPassageOpen} passage={passage} />
      ) : null}

      {figureItemId ? (
        <ItemFigureDialog
          open={figureOpen}
          onOpenChange={setFigureOpen}
          itemId={figureItemId}
          position={position}
        />
      ) : null}
    </Sheet>
  );
}
