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
import { IdentityModeSelector } from './IdentityModeSelector';
import { parseIdentityModeParam, type DesignIdentityMode } from './identity-mode';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ identidad?: string }>;
};

export default async function DisenarPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, SHEET_MANAGEMENT_ROLES)) redirect(ROUTES.dashboard);

  const { id: instrumentId } = await params;
  const identityMode = parseIdentityModeParam((await searchParams).identidad);

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<BackLink href={HOJAS_ROUTES.index} label="Hojas de respuesta" />}
        title="Diseñar hoja de respuesta"
        description="Revisa la propuesta derivada del instrumento. Al congelarla, el layout queda inmutable y su hash viaja en el QR de cada hoja impresa."
      />
      <IdentityModeSelector mode={identityMode} />
      <Suspense fallback={<CardSkeleton />}>
        <DeriveSection instrumentId={instrumentId} identityMode={identityMode} />
      </Suspense>
    </PageContainer>
  );
}

async function DeriveSection({
  instrumentId,
  identityMode,
}: {
  instrumentId: string;
  identityMode: DesignIdentityMode;
}) {
  const draft = await deriveDraftOrNotFound(instrumentId, identityMode);
  const instrument = await apiGet<InstrumentModel>(`/instruments/${instrumentId}`).catch(
    () => null,
  );

  return <LayoutDesigner draft={draft} instrumentName={instrument?.name ?? null} />;
}

async function deriveDraftOrNotFound(
  instrumentId: string,
  identityMode: DesignIdentityMode,
): Promise<LayoutDraftModel> {
  try {
    return await apiPost<LayoutDraftModel>('/sheet-layouts/derive', { instrumentId, identityMode });
  } catch (e) {
    if (e instanceof ApiRequestError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
}
