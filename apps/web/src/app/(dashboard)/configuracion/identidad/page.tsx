import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { canAccess, ORG_BRANDING_ROLES, type OrgBrandingResponse } from '@soe/types';
import { PageContainer, CardSkeleton } from '@/components/shared';
import { ConfigHubHeader } from '../components/ConfigHubHeader';
import { BrandingForm } from './branding-form';

/**
 * Identidad del colegio (Editor de Materiales): logo, colores y textos que
 * llevan las cabeceras/pies de los documentos imprimibles. Se persiste en
 * `organizations.config.branding`.
 */
export default async function IdentidadPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  const allowed =
    Boolean(session.user.isPlatformAdmin) ||
    canAccess(session.user.roles, ORG_BRANDING_ROLES);
  if (!allowed) redirect(ROUTES.dashboard);

  return (
    <PageContainer>
      <ConfigHubHeader />

      <Suspense
        fallback={
          <>
            <CardSkeleton rows={3} />
            <CardSkeleton rows={3} />
          </>
        }
      >
        <BrandingSection />
      </Suspense>
    </PageContainer>
  );
}

async function BrandingSection() {
  const branding = await apiGet<OrgBrandingResponse>('/organizations/me/branding');
  return <BrandingForm initial={branding} />;
}
