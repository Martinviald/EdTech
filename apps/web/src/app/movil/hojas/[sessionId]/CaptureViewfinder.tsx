'use client';

import { sheetGuideGeometry } from '@soe/types';

/** Estilo de las guías dibujadas sobre el visor. */
export type GuideStyle = 'corners' | 'corners-qr' | 'mask';

/**
 * Geometría real de la hoja, derivada del `LayoutSpec` (papel, fiduciales y zona
 * del QR) — la misma verdad que consumen el impresor y el lector.
 *
 * ⚠️ No inventar estos números. El marco es carta (17/22), los cuadrados de
 * fiducial van SEPARADOS del borde (`marginRatio`, 3% del ancho) y no pegados a
 * la esquina, y la zona del QR se convierte desde coordenadas del marco de
 * fiduciales a coordenadas de página. Dibujarlos "a ojo" deja las guías corridas
 * respecto de las marcas impresas y el encuadre deja de servir.
 */
const GUIDE = sheetGuideGeometry();

/** Del ancho del marco: el fiducial es cuadrado, su alto se deriva de la razón. */
const FIDUCIAL_SIZE_PCT = GUIDE.fiducialSize * 100;
const FIDUCIAL_MARGIN_PCT = GUIDE.fiducialMargin * 100;

function FiducialSquare({ corner }: { corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const horizontal = corner === 'tl' || corner === 'bl' ? 'left' : 'right';
  const vertical = corner === 'tl' || corner === 'tr' ? 'top' : 'bottom';
  return (
    <span
      aria-hidden
      className="absolute rounded-[3px] border-[2.5px] border-[hsl(var(--brand-300))] shadow-[0_0_0_1px_rgb(2_6_23_/_0.35)]"
      style={{
        width: `${FIDUCIAL_SIZE_PCT}%`,
        aspectRatio: '1',
        [horizontal]: `${FIDUCIAL_MARGIN_PCT}%`,
        // El margen vertical se expresa en % del ANCHO igual que el horizontal,
        // así el cuadrado queda a la misma distancia real de ambos bordes.
        [vertical]: `${FIDUCIAL_MARGIN_PCT * GUIDE.aspectRatio}%`,
      }}
    />
  );
}

/**
 * Marco de encuadre con los cuatro cuadrados de fiducial y (opcional) la zona del
 * QR. Es puramente visual: no intercepta toques, para no comerse el obturador.
 */
export function CaptureViewfinder({ guideStyle = 'corners-qr' }: { guideStyle?: GuideStyle }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 inset-y-[10px] flex items-center justify-center">
      <div
        className="relative h-full rounded border border-white/30"
        style={{
          aspectRatio: String(GUIDE.aspectRatio),
          boxShadow: guideStyle === 'mask' ? '0 0 0 9999px rgb(2 6 23 / 0.55)' : undefined,
        }}
      >
        <FiducialSquare corner="tl" />
        <FiducialSquare corner="tr" />
        <FiducialSquare corner="bl" />
        <FiducialSquare corner="br" />

        {guideStyle === 'corners-qr' && (
          <span
            aria-hidden
            className="absolute flex items-start justify-center rounded-md border-[1.5px] border-dashed border-[hsl(var(--violet-400))] pt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--violet-200))]"
            style={{
              left: `${GUIDE.qr.left * 100}%`,
              top: `${GUIDE.qr.top * 100}%`,
              width: `${GUIDE.qr.width * 100}%`,
              height: `${GUIDE.qr.height * 100}%`,
            }}
          >
            QR
          </span>
        )}
      </div>
    </div>
  );
}
