import { PageTabs } from '@/components/shared';
import { BANCO_TABS, toPageTabs } from '@/components/layout/view-tabs';

/**
 * Pestañas del hub del Banco de contenido. Se renderiza en el `layout.tsx` del
 * route group `(hub)`, por lo que persiste al cambiar de tab (`/banco-contenido` ↔
 * `/banco-contenido/explorar`). El título del hub lo pinta la barra superior y las
 * acciones propias de cada tab (p. ej. "Nuevo instrumento") las renderiza la
 * tab-page en su contenido, no acá.
 */
export function BancoHubHeader() {
  return <PageTabs tabs={toPageTabs(BANCO_TABS)} />;
}
