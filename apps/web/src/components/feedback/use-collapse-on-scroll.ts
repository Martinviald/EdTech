'use client';

import { useEffect, useState } from 'react';

/** Cuánto silencio de scroll hace falta para volver a expandir. */
const IDLE_MS = 700;

/**
 * `true` mientras la persona está haciendo scroll. El botón de comentarios lo
 * usa para colapsar a un círculo: expandido es descubrible, pero mientras se
 * recorre una tabla larga estorba, y ahí ya nadie lo está buscando.
 *
 * El listener va en `document` con captura porque el scroll del dashboard NO
 * ocurre en `window` sino dentro del `<main>` (`overflow-y-auto`), y los eventos
 * de scroll no burbujean.
 */
export function useCollapseOnScroll(): boolean {
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    let idle: number | undefined;

    const onScroll = () => {
      setScrolling(true);
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setScrolling(false), IDLE_MS);
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.clearTimeout(idle);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, []);

  return scrolling;
}
