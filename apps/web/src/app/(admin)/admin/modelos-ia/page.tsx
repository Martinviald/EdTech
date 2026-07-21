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
      <div>
        <h1 className="text-2xl font-semibold">Modelos de IA</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Elige el proveedor (Gemini/Claude) y el modelo que usa cada funcionalidad de IA. La
          configuración es global: aplica a todas las organizaciones. El límite de tokens se ajusta
          automáticamente según el modelo elegido.
        </p>
      </div>

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
