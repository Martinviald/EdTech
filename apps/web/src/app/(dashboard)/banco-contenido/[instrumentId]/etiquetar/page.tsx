import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  ITEM_BANK_ROLES,
  type InstrumentModel,
  type ItemModel,
  type TaxonomyModel,
  type PaginatedResponse,
} from '@soe/types';
import { AiTaggingWizard } from './AiTaggingWizard';
import { SetPageTitle } from '@/components/layout/page-title-context';

type ItemsListResponse = PaginatedResponse<ItemModel>;

type PageProps = {
  params: Promise<{ instrumentId: string }>;
};

export default async function EtiquetarPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_BANK_ROLES)) redirect(ROUTES.dashboard);

  const { instrumentId } = await params;

  const [instrument, itemsResponse, taxonomies] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<ItemsListResponse>(`/items?instrumentId=${instrumentId}&limit=200`),
    apiGet<TaxonomyModel[]>('/taxonomies'),
  ]);

  return (
    <div className="space-y-6">
      <SetPageTitle
        title="Etiquetado con IA"
        parentHref={ROUTES.bancoItem(instrumentId)}
        parentLabel={instrument.name}
      />

      <AiTaggingWizard
        instrumentId={instrumentId}
        items={itemsResponse.data}
        taxonomies={taxonomies}
      />
    </div>
  );
}
