'use client';

/** Tope del backend para la captura (ver feedbackScreenshotUrlSchema). */
const MAX_BYTES = 10 * 1024 * 1024;

/** Marca del contenedor de la app en el layout del dashboard. */
const APP_SHELL_SELECTOR = '[data-app-shell]';

/**
 * Captura la pantalla actual de la app renderizando el DOM a una imagen.
 *
 * Por qué el DOM y no `getDisplayMedia`: el nativo abre un diálogo donde la
 * persona debe elegir qué compartir y confirmar. Ese diálogo es exactamente el
 * roce que el widget existe para evitar. Acá es un clic y ya está.
 *
 * Dos decisiones que explican el código de abajo:
 *
 *  1. **Se captura el shell de la app, no `document.body`.** El panel del widget
 *     vive en un portal de Radix que cuelga de `body`, fuera del shell. Capturar
 *     el shell lo deja afuera solo, sin tener que cerrarlo (lo que perdería el
 *     texto ya escrito) ni filtrar nodos a mano.
 *
 *  2. **Se expande el contenedor con scroll antes de capturar.** El clon que hace
 *     `html-to-image` nace con `scrollTop = 0`: si no se expande, la captura sale
 *     del comienzo de la página y no de donde la persona está mirando. Expandir
 *     el alto captura la vista COMPLETA — incluido lo que queda fuera de pantalla,
 *     que suele ser justo lo que hace falta para entender el reporte.
 *
 * Devuelve `null` ante cualquier fallo: una captura que no sale nunca debe
 * impedir que se envíe el comentario.
 */
export async function captureAppScreenshot(): Promise<File | null> {
  if (typeof document === 'undefined') return null;

  const shell = document.querySelector<HTMLElement>(APP_SHELL_SELECTOR);
  if (!shell) return null;

  // Contenedores con scroll propio dentro del shell (el `<main>` del dashboard).
  const scrollers = Array.from(shell.querySelectorAll<HTMLElement>('*')).filter(
    (el) => el.scrollHeight > el.clientHeight && isScrollable(el),
  );
  const restore = relaxOverflow([shell, ...scrollers]);

  try {
    const { toBlob } = await import('html-to-image');

    const blob = await toBlob(shell, {
      type: 'image/jpeg',
      quality: 0.85,
      // JPEG no tiene transparencia: sin fondo explícito las zonas sin pintar
      // salen negras. Se toma el fondo real del tema activo (claro u oscuro).
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
      // En pantallas Retina el ratio nativo cuadruplica el peso sin aportar nada
      // legible para un reporte.
      pixelRatio: 1,
      // Excluye el botón flotante del propio widget: no aporta al reporte y
      // confunde sobre dónde estaba la persona.
      filter: (node) => !(node instanceof Element && node.hasAttribute('data-feedback-ui')),
    });

    if (!blob || blob.size === 0 || blob.size > MAX_BYTES) return null;

    return new File([blob], `captura-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } catch {
    return null;
  } finally {
    restore();
  }
}

function isScrollable(el: HTMLElement): boolean {
  const overflowY = getComputedStyle(el).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

/**
 * Quita temporalmente el recorte por scroll para que la captura incluya todo el
 * contenido. Devuelve la función que restaura los estilos originales, que el
 * llamador DEBE correr en un `finally`: si esto no se revierte, el dashboard
 * queda con el layout roto.
 */
function relaxOverflow(elements: HTMLElement[]): () => void {
  const previous = elements.map((el) => ({
    el,
    overflow: el.style.overflow,
    height: el.style.height,
    maxHeight: el.style.maxHeight,
  }));

  for (const el of elements) {
    el.style.overflow = 'visible';
    el.style.height = 'auto';
    el.style.maxHeight = 'none';
  }

  return () => {
    for (const { el, overflow, height, maxHeight } of previous) {
      el.style.overflow = overflow;
      el.style.height = height;
      el.style.maxHeight = maxHeight;
    }
  };
}
