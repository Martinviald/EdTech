import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import {
  canAccess,
  SHEET_MANAGEMENT_ROLES,
  type InstrumentModel,
  type LayoutDraftModel,
} from '@soe/types';
import { auth } from '@/auth';
import { apiGet, apiPost } from '@/lib/api';
import { ApiRequestError } from '@/lib/errors';
import { ROUTES } from '@/lib/routes';
import { BackLink, PageContainer, PageHeader, CardSkeleton } from '@/components/shared';
import { HOJAS_ROUTES } from '../../lib/routes';
import { LayoutDesigner } from './LayoutDesigner';

type PageProps = { params: Promise<{ id: string }> };

export default async function DisenarPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, SHEET_MANAGEMENT_ROLES)) redirect(ROUTES.dashboard);

  const { id: instrumentId } = await params;

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<BackLink href={HOJAS_ROUTES.index} label="Hojas de respuesta" />}
        title="Diseñar hoja de respuesta"
        description="Revisa la propuesta derivada del instrumento. Al congelarla, el layout queda inmutable y su hash viaja en el QR de cada hoja impresa."
      />
      <Suspense fallback={<CardSkeleton />}>
        <DeriveSection instrumentId={instrumentId} />
      </Suspense>
    </PageContainer>
  );
}

async function DeriveSection({ instrumentId }: { instrumentId: string }) {
  const draft = await deriveDraftOrNotFound(instrumentId);
  const instrument = await apiGet<InstrumentModel>(`/instruments/${instrumentId}`).catch(
    () => null,
  );

  return <LayoutDesigner draft={draft} instrumentName={instrument?.name ?? null} />;
}

async function deriveDraftOrNotFound(instrumentId: string): Promise<LayoutDraftModel> {
  try {
    return await apiPost<LayoutDraftModel>('/sheet-layouts/derive', { instrumentId });
  } catch (e) {
    if (e instanceof ApiRequestError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}
