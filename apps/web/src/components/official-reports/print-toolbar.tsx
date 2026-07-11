'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Barra de acciones del informe oficial. Reutiliza el patrón de export
// client-side del proyecto, pero para un informe de LAYOUT fiel (no una tabla): la
// forma correcta de obtener el PDF idéntico a la pantalla es "Imprimir → Guardar
// como PDF" del navegador. El print stylesheet global (`globals.css`) aísla el
// `.print-root` y oculta el resto de la app al imprimir.
//
// Se oculta a sí misma al imprimir (`print:hidden`).
// ─────────────────────────────────────────────────────────────────────────────

import type { JSX } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PrintToolbar({ children }: { children?: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
      {children}
      <Button variant="default" size="sm" onClick={() => window.print()}>
        <Printer className="mr-2 size-4" aria-hidden />
        Imprimir / Guardar PDF
      </Button>
    </div>
  );
}
