import { PageTabs } from '@/components/shared';
import { BANCO_TABS, toPageTabs } from '@/components/layout/view-tabs';

/**
 * Encabezado + pestañas del hub del Banco de contenido. Se renderiza en el
 * `layout.tsx` del route group `(hub)`, por lo que persiste al cambiar de tab
 * (`/banco-items` ↔ `/banco-items/explorar`). Las acciones propias de cada tab
 * (p. ej. "Nuevo instrumento") las renderiza la tab-page en su contenido, no acá.
 */
export function BancoHubHeader() {
  // T2-25: tabs y título en una sola fila (título a la derecha) para aprovechar
  // el alto de la ventana, en vez de apilarlos.
  return (
    <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
      <PageTabs tabs={toPageTabs(BANCO_TABS)} />
      <div className="min-w-0 sm:text-right">
        <h1 className="text-base font-semibold tracking-tight">Banco de contenido</h1>
        <p className="text-xs text-muted-foreground">
          Instrumentos de evaluación y el banco de ítems del colegio.
        </p>
      </div>
    </div>
  );
}
