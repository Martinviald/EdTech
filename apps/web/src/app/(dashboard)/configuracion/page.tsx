import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { accessibleConfigOptions } from './components/ConfigHubHeader';

/**
 * Hub de Configuración: es un conjunto de pestañas (Escalas, Modelos de IA,
 * Observabilidad IA). El índice redirige a la primera opción accesible según el
 * rol; las tabs viven en cada sub-página vía `ConfigHubHeader`.
 */
export default async function ConfiguracionPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);

  const options = accessibleConfigOptions(
    session.user.roles,
    Boolean(session.user.isPlatformAdmin),
  );
  if (options.length === 0) redirect(ROUTES.dashboard);

  redirect(options[0]!.href);
}
