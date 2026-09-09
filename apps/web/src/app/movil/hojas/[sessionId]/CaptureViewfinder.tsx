'use client';

/** Estilo de las guías dibujadas sobre el visor. */
export type GuideStyle = 'corners' | 'corners-qr' | 'mask';

/**
 * Razón de aspecto del layout de la hoja de respuestas. El lector se orienta con los
 * cuatro cuadrados negros impresos en las esquinas (docs/diseno-lector-de-marcas/09),
 * así que el marco tiene que calzar con la hoja real, no ser un rectángulo decorativo.
 */
const SHEET_ASPECT_RATIO = 0.7569;

/** Cuadrado guía de fiducial, pegado a una esquina del marco. */
function FiducialSquare({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`absolute size-7 rounded-[3px] border-[2.5px] border-[hsl(var(--brand-300))] shadow-[0_0_0_1px_rgb(2_6_23_/_0.35)] ${className}`}
    />
  );
}

/**
 * Marco de encuadre con los cuatro cuadrados de fiducial y (opcional) la zona del QR.
 * Es puramente visual: no intercepta toques, para no comerse el obturador.
 */
export function CaptureViewfinder({ guideStyle = 'corners-qr' }: { guideStyle?: GuideStyle }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 inset-y-[10px] flex items-center justify-center">
      <div
        className="relative h-full rounded border border-white/30"
        style={{
          aspectRatio: String(SHEET_ASPECT_RATIO),
          boxShadow: guideStyle === 'mask' ? '0 0 0 9999px rgb(2 6 23 / 0.55)' : undefined,
        }}
      >
        <FiducialSquare className="left-0 top-0" />
        <FiducialSquare className="right-0 top-0" />
        <FiducialSquare className="bottom-0 left-0" />
        <FiducialSquare className="bottom-0 right-0" />

        {guideStyle === 'corners-qr' && (
          <span
            aria-hidden
            className="absolute flex items-center justify-center rounded-md border-[1.5px] border-dashed border-[hsl(var(--violet-400))] text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--violet-200))]"
            style={{ width: '23%', aspectRatio: '1', top: '12.5%', right: '9.5%' }}
          >
            QR
          </span>
        )}
      </div>
    </div>
  );
}
