import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { canAccess, LLM_SETTINGS_ROLES, type LlmSettingsResponse } from '@soe/types';
import { AiModelsForm } from '@/components/ai-models/ai-models-form';
import { PageContainer, CardSkeleton } from '@/components/shared';
import { ConfigHubHeader } from '../components/ConfigHubHeader';

/**
 * Panel de configuración de modelos de IA por funcionalidad (sólo platform_admin).
 * La elección es GLOBAL (todas las orgs) y la consume `LlmConfigService` en runtime.
 */
export default async function ModelosIaPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  // Un platform_admin siempre puede (mirror del bypass del RolesGuard); canAccess
  // cubre el futuro caso de que LLM_SETTINGS_ROLES incluya más roles.
  const allowed =
    Boolean(session.user.isPlatformAdmin) ||
    canAccess(session.user.roles, LLM_SETTINGS_ROLES);
  if (!allowed) {
    redirect(ROUTES.dashboard);
  }

  return (
    <PageContainer>
      <ConfigHubHeader description="Elige el proveedor y el modelo que usa cada funcionalidad de IA. La configuración es global: aplica a todas las organizaciones. El límite de tokens se ajusta automáticamente según el modelo elegido." />

      <Suspense
        fallback={
          <>
            <CardSkeleton rows={4} />
            <CardSkeleton rows={4} />
          </>
        }
      >
        <AiModelsSection />
      </Suspense>
    </PageContainer>
  );
}

async function AiModelsSection() {
  const settings = await apiGet<LlmSettingsResponse>('/llm-settings');
  return <AiModelsForm initial={settings} />;
}
