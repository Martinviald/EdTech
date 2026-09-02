'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'soe.feedback.hint-seen';
/** Deja que la vista termine de cargar antes de aparecer. */
const APPEAR_DELAY_MS = 1_500;
/** Se va solo: si la persona lo ignora, no queda nada pendiente en pantalla. */
const AUTO_DISMISS_MS = 8_000;

/**
 * Aviso de una sola vez, anclado al botón de comentarios. Resuelve el arranque
 * en frío —nadie usa un canal que no sabe que existe— sin cobrar una interrupción
 * recurrente: aparece una vez en la vida del navegador y no vuelve.
 *
 * Todo acceso a `localStorage` va en try/catch: en ventanas privadas o con las
 * cookies de sitio bloqueadas, leer o escribir lanza. Ante la duda, el aviso NO
 * se muestra — un aviso perdido es mucho más barato que uno repetido en cada
 * carga de página.
 */
export function useFirstTimeHint(): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Sin persistencia el aviso volvería en la próxima carga. Es el caso raro
      // (modo privado) y sigue siendo un globo que se cierra solo.
    }
  }, []);

  useEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return;
    }
    if (seen) return;

    const appear = window.setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    return () => window.clearTimeout(appear);
  }, []);

  useEffect(() => {
    if (!visible) return;

    const auto = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    // Cualquier clic en la página cuenta como "ya lo vi": si la persona siguió
    // trabajando, el aviso cumplió su función o no le interesa.
    const onPointerDown = () => dismiss();
    window.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.clearTimeout(auto);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [visible, dismiss]);

  return { visible, dismiss };
}
