'use client';

import { useEffect, useRef } from 'react';

/**
 * Ajusta la caja de la app al viewport VISIBLE del navegador móvil.
 *
 * `100dvh` no alcanza: el chrome del navegador cambia entre sesiones y durante el
 * scroll (a veces sólo barra inferior, a veces superior e inferior), y en iOS la
 * barra de direcciones se superpone al layout viewport en vez de recortarlo. El
 * resultado era que la barra de acciones quedaba debajo del chrome o sobraba
 * espacio arriba.
 *
 * `visualViewport` da el rectángulo que el usuario realmente ve — alto y
 * desplazamiento superior — y con eso la caja calza exactamente, tenga el
 * navegador una barra, dos o ninguna. `100dvh` queda de respaldo cuando la API no
 * existe (y como valor inicial antes del primer efecto).
 */
export function MobileViewportFrame({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const node = ref.current;
        if (!node) return;
        node.style.height = `${viewport.height}px`;
        node.style.top = `${viewport.offsetTop}px`;
      });
    };

    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-x-0 top-0 flex h-dvh flex-col overflow-hidden bg-[rgb(2_6_23)] text-[hsl(var(--neutral-0))]"
    >
      {children}
    </div>
  );
}
