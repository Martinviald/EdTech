import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  userHasAnyRole,
  ITEM_BANK_ROLES,
  ITEM_VIEWER_ROLES,
  type InstrumentModel,
  type ItemModel,
} from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { SpecTableView } from './SpecTableView';

type ItemsListResponse = {
  data: ItemModel[];
  total: number;
  page: number;
  limit: number;
};

interface PageProps {
  params: Promise<{ instrumentId: string }>;
}

export default async function SpecTablePage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  // La tabla de especificaciones es de LECTURA para todo rol que puede ver el
  // banco de ítems. La acción de cargar/editar se gatea aparte con `canEdit`.
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { instrumentId } = await params;

  const [instrument, itemsResponse] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<ItemsListResponse>(`/items?instrumentId=${instrumentId}&limit=200`),
  ]);

  const items = itemsResponse.data ?? [];

  const canEdit =
    userHasAnyRole(session.user.roles, ITEM_BANK_ROLES) &&
    (!instrument.isOfficial || session.user.isPlatformAdmin);

  return (
    <SpecTableView
      instrument={instrument}
      items={items}
      canEdit={canEdit}
      basePath={ROUTES.bancoItems}
      breadcrumb={{ href: ROUTES.bancoItems, label: 'Banco de Instrumentos' }}
    />
  );
}
