import type { ReactNode } from 'react';

import { PageContainer } from '@/components/shared';
import { BancoHubHeader } from '../components/BancoHubHeader';

/**
 * Shell del hub del Banco de contenido: encabezado + pestañas viven acá, así
 * persisten al cambiar entre las tabs (`/banco-items` ↔ `/banco-items/explorar`)
 * sin re-montarse — solo el contenido de cada tab streamea. El route group
 * `(hub)` acota este layout a las dos tabs: `[instrumentId]`, `nuevo`, etc.
 * quedan fuera y no lo heredan.
 */
export default function BancoHubLayout({ children }: { children: ReactNode }) {
  return (
    <PageContainer>
      <BancoHubHeader />
      {children}
    </PageContainer>
  );
}
