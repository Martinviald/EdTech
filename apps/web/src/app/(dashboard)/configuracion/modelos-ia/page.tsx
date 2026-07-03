import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { canAccess, LLM_SETTINGS_ROLES, type LlmSettingsResponse } from '@soe/types';
import { AiModelsForm } from '@/components/ai-models/ai-models-form';

/**
 * Panel de configuración de modelos de IA por funcionalidad (sólo platform_admin).
 * La elección es GLOBAL (todas las orgs) y la consume `LlmConfigService` en runtime.
 */
export default async function ModelosIaPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  // Un platform_admin siempre puede (mirror del bypass del RolesGuard); canAccess
  // cubre el futuro caso de que LLM_SETTINGS_ROLES incluya más roles.
  const allowed =
    Boolean(session.user.isPlatformAdmin) ||
    canAccess(session.user.roles, LLM_SETTINGS_ROLES);
  if (!allowed) {
    redirect('/dashboard');
  }

  const settings = await apiGet<LlmSettingsResponse>('/llm-settings');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={'/configuracion' as Route} className="hover:text-foreground">
          Configuración
        </Link>
        <span>/</span>
        <span>Modelos de IA</span>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Modelos de IA</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Elige el proveedor y el modelo que usa cada funcionalidad de IA. La configuración es
          global: aplica a todas las organizaciones. El límite de tokens se ajusta automáticamente
          según el modelo elegido.
        </p>
      </div>

      <AiModelsForm initial={settings} />
    </div>
  );
}
