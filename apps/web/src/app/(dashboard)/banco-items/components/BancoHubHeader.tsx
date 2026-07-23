import { PageHeader, PageTabs } from '@/components/shared';
import { BANCO_TABS, toPageTabs } from '@/components/layout/view-tabs';

/**
 * Encabezado + pestañas del hub del Banco de contenido. Se renderiza en el
 * `layout.tsx` del route group `(hub)`, por lo que persiste al cambiar de tab
 * (`/banco-items` ↔ `/banco-items/explorar`). Las acciones propias de cada tab
 * (p. ej. "Nuevo instrumento") las renderiza la tab-page en su contenido, no acá.
 */
export function BancoHubHeader() {
  return (
    <>
      <PageHeader
        title="Banco de contenido"
        description="Instrumentos de evaluación y el banco de ítems del colegio."
      />
      <PageTabs tabs={toPageTabs(BANCO_TABS)} sticky />
    </>
  );
}
