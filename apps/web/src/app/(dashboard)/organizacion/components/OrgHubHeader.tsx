import Link from 'next/link';

import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { PageActions } from '@/components/shared';

import { getOrgOverview } from '../overview';

/**
 * Acción de setup del hub de Organización. Ya no lleva pestañas: las asignaciones
 * docentes se mudaron a `/equipo/asignaciones` (ver `EquipoHubHeader`). El título
 * del hub lo pinta la barra superior.
 */
export async function OrgHubHeader() {
  const { isSetupComplete } = await getOrgOverview();

  if (isSetupComplete) return null;
  return (
    <PageActions>
      <Button asChild variant="outline">
        <Link href={ROUTES.organizacionConfigurar}>Completar configuración</Link>
      </Button>
    </PageActions>
  );
}
