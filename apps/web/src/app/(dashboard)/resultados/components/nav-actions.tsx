'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Acciones de una tab de Resultados que viven EN LA MISMA FILA que las pestañas
// (`ResultadosNav`), no en una banda propia debajo que reste alto. `ResultadosNav`
// monta el destino (`ResultadosNavActionsSlot`) dentro de la fila de tabs; cada
// página teletransporta ahí sus botones/toggles con `ResultadosNavActions`.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const SLOT_ID = 'resultados-nav-actions';

/** Destino del portal, montado por `ResultadosNav` al final de la fila de tabs. */
export function ResultadosNavActionsSlot() {
  return <div id={SLOT_ID} className="flex items-center gap-2" />;
}

/** Teletransporta sus children a la fila de tabs. `null` hasta que el destino existe. */
export function ResultadosNavActions({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.getElementById(SLOT_ID));
  }, []);
  if (!target) return null;
  return createPortal(children, target);
}
