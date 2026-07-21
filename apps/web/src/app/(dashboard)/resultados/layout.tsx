import type { ReactNode } from 'react';

import { PageContainer, PageHeader } from '@/components/shared';
import { ResultadosNav } from './components/resultados-nav';

/**
 * Shell del hub de Resultados: las tabs viven acá (persisten al cambiar de tab,
 * sin re-montarse). Cada tab-page renderiza solo su encabezado + contenido.
 * `detalle`/`informe` son redirect-only, así que envolverlas con las tabs es
 * inofensivo (redirigen antes de pintar).
 */
export default function ResultadosLayout({ children }: { children: ReactNode }) {
  return (
    <PageContainer>
      <PageHeader
        title="Panorama pedagógico"
        description="Logro, evaluaciones recientes y alertas del alcance filtrado."
      />
      <ResultadosNav />
      {children}
    </PageContainer>
  );
}
