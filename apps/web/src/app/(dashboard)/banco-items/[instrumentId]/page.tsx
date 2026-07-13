import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  userHasAnyRole,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_ROLES,
  type InstrumentModel,
  type ItemModel,
} from '@soe/types';
import { InstrumentDetailView } from './InstrumentDetailView';

type ItemsListResponse = {
  data: ItemModel[];
  total: number;
  page: number;
  limit: number;
};

type PageProps = {
  params: Promise<{ instrumentId: string }>;
};

export default async function InstrumentDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect('/dashboard');

  const { instrumentId } = await params;

  const [instrument, itemsResponse] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<ItemsListResponse>(`/items?instrumentId=${instrumentId}&limit=200`),
  ]);

  // Los instrumentos OFICIALES sólo los configura platform_admin (CLAUDE.md §8.2).
  // El resto los ve en modo solo lectura — el backend ya lo impone
  // (InstrumentsService.assertEditable); aquí ocultamos las acciones de edición.
  const canEdit =
    userHasAnyRole(session.user.roles, ITEM_BANK_ROLES) &&
    (!instrument.isOfficial || session.user.isPlatformAdmin);

  return (
    <InstrumentDetailView
      instrument={instrument}
      items={itemsResponse.data}
      canEdit={canEdit}
      basePath="/banco-items"
      breadcrumb={{ href: '/banco-items', label: 'Banco de Instrumentos' }}
    />
  );
}
