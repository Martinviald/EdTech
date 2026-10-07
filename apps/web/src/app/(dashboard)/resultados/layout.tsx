import type { ReactNode } from 'react';

import { auth } from '@/auth';
import { canAccess, ESTABLISHMENT_REPORT_ROLES } from '@soe/types';
import { PageContainer } from '@/components/shared';
import { ResultadosNav } from './components/resultados-nav';

/**
 * Shell del hub de Resultados: las tabs viven acá (persisten al cambiar de tab,
 * sin re-montarse). Cada tab-page renderiza solo su encabezado + contenido.
 * `detalle`/`informe` son redirect-only, así que envolverlas con las tabs es
 * inofensivo (redirigen antes de pintar).
 */
export default async function ResultadosLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const canOpenEstablishmentReport = session?.user
    ? canAccess(session.user.roles, ESTABLISHMENT_REPORT_ROLES)
    : false;

  return (
    <PageContainer>
      <ResultadosNav canOpenEstablishmentReport={canOpenEstablishmentReport} />
      {children}
    </PageContainer>
  );
}
