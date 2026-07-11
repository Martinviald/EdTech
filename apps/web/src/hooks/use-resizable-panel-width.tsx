'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

type ResizablePanelOptions = {
  /** Clave de localStorage donde se persiste el ancho. */
  storageKey: string;
  /** Ancho inicial (antes de hidratar desde localStorage). */
  defaultWidth: number;
  /** Ancho mínimo permitido. */
  minWidth: number;
  /** Tope superior absoluto (además del acote a viewport−32). Default 900. */
  maxWidth?: number;
  /** Paso del ajuste por teclado (flechas). Default 24. */
  keyboardStep?: number;
};

/**
 * Ancho de un panel lateral anclado a la derecha, persistido en localStorage y
 * ajustable arrastrando su borde izquierdo (ancho = distancia del cursor al borde
 * derecho de la ventana). Re-acota ante `resize` para no exceder la pantalla.
 * Devuelve el ancho y los handlers del tirador (puntero + teclado). Compartido por
 * el panel del asistente y el panel de detalle de pregunta.
 */
export function useResizablePanelWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth = 900,
  keyboardStep = 24,
}: ResizablePanelOptions) {
  const clampWidth = useCallback(
    (width: number): number => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const max = Math.min(maxWidth, viewport - 32);
      return Math.max(minWidth, Math.min(width, max));
    },
    [minWidth, maxWidth],
  );

  const [width, setWidth] = useState(defaultWidth);
  const widthRef = useRef(defaultWidth);

  const apply = useCallback(
    (next: number) => {
      const clamped = clampWidth(next);
      widthRef.current = clamped;
      setWidth(clamped);
    },
    [clampWidth],
  );

  // Hidratar desde localStorage tras montar (evita mismatch SSR) + re-acotar en resize.
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(storageKey));
    apply(Number.isFinite(saved) && saved > 0 ? saved : defaultWidth);

    const onResize = () => apply(widthRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [apply, storageKey, defaultWidth]);

  const persist = useCallback(() => {
    window.localStorage.setItem(storageKey, String(widthRef.current));
  }, [storageKey]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMove = (ev: PointerEvent) => apply(window.innerWidth - ev.clientX);
      const onUp = () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        persist();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [apply, persist],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      // Borde izquierdo: ← ensancha, → angosta.
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        apply(widthRef.current + keyboardStep);
        persist();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        apply(widthRef.current - keyboardStep);
        persist();
      }
    },
    [apply, persist, keyboardStep],
  );

  return { width, onPointerDown, onKeyDown };
}

/**
 * Tirador de redimensionado para el borde IZQUIERDO de un panel anclado a la
 * derecha (el `SheetContent` debe ser `position: relative`/absolute-anchored, que
 * es el caso de los `Sheet` de shadcn). Arrastra o usa las flechas del teclado.
 */
export function PanelResizeHandle({
  onPointerDown,
  onKeyDown,
}: {
  onPointerDown: (e: ReactPointerEvent) => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
}): JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ajustar ancho del panel"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 left-0 z-50 flex w-2 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
    >
      <span className="h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
    </div>
  );
}
