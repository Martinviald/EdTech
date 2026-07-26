import { PageTabs, type PageTab } from '@/components/shared';
import { ROUTES } from '@/lib/routes';

/**
 * Tabs del detalle de colegio (backoffice). Renderiza vía `PageTabs`, que aporta
 * el estado activo optimista + barra de progreso al navegar (rule 07).
 */
export function TabNav({ orgId }: { orgId: string }) {
  const tabs: PageTab[] = [
    { href: ROUTES.adminColegio(orgId), label: 'Perfil', exact: true },
    { href: ROUTES.adminColegioMiembros(orgId), label: 'Miembros' },
    { href: ROUTES.adminColegioAsignaturas(orgId), label: 'Asignaturas' },
    { href: ROUTES.adminColegioCursos(orgId), label: 'Cursos' },
  ];

  return <PageTabs tabs={tabs} />;
}
