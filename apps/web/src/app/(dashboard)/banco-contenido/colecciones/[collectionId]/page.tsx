import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  ITEM_BANK_ROLES,
  ITEM_VIEWER_ROLES,
  type ItemCollectionDetailModel,
} from '@soe/types';
import { PageContainer } from '@/components/shared';
import { CollectionDetailView } from './CollectionDetailView';

type PageProps = { params: Promise<{ collectionId: string }> };

export default async function ColeccionDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { collectionId } = await params;

  let collection: ItemCollectionDetailModel;
  try {
    collection = await apiGet<ItemCollectionDetailModel>(`/item-collections/${collectionId}`);
  } catch {
    notFound();
  }

  const canManage = canAccess(session.user.roles, ITEM_BANK_ROLES);

  return (
    <PageContainer>
      <CollectionDetailView collection={collection} canManage={canManage} />
    </PageContainer>
  );
}
