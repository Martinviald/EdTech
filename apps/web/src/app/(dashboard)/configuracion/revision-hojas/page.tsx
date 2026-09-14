import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { canAccess, REVIEW_SETTINGS_ROLES, type OrgReviewSettingsResponse } from '@soe/types';
import { PageContainer, CardSkeleton } from '@/components/shared';
import { ConfigHubHeader } from '../components/ConfigHubHeader';
import { ReviewSettingsForm } from './review-settings-form';

/**
 * Revisión de hojas: ajustes de la cola de revisión del lector de marcas
 * (confirmar con Sí/No, nula automática de dobles marcas). Se persiste en
 * `organizations.config.review`; mismo público que la calibración OMR.
 */
export default async function RevisionHojasPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  const allowed =
    Boolean(session.user.isPlatformAdmin) ||
    canAccess(session.user.roles, REVIEW_SETTINGS_ROLES);
  if (!allowed) redirect(ROUTES.dashboard);

  return (
    <PageContainer>
      <ConfigHubHeader />

      <Suspense
        fallback={
          <>
            <CardSkeleton rows={2} />
            <CardSkeleton rows={3} />
          </>
        }
      >
        <ReviewSettingsSection />
      </Suspense>
    </PageContainer>
  );
}

async function ReviewSettingsSection() {
  const settings = await apiGet<OrgReviewSettingsResponse>('/organizations/me/review-settings');
  return <ReviewSettingsForm initial={settings} />;
}
