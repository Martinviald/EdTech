import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import type { LlmSettingsResponse } from '@soe/types';
import { AiModelsForm } from '@/components/ai-models/ai-models-form';
import { CardSkeleton } from '@/components/shared';

/**
 * Configuración GLOBAL de modelos de IA por funcionalidad (área plataforma). El
 * `(admin)/layout.tsx` ya exige `isPlatformAdmin`; aquí sólo se carga y edita la
 * config. La consume `LlmConfigService` en runtime.
 */
export default function AdminModelosIaPage() {
  return (
    <div className="space-y-6">
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
    </div>
  );
}

async function AiModelsSection() {
  const settings = await apiGet<LlmSettingsResponse>('/llm-settings');
  return <AiModelsForm initial={settings} />;
}
