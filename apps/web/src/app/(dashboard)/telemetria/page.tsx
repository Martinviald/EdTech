import { redirect } from 'next/navigation';
import { canAccess, TELEMETRY_VIEWER_ROLES, type TelemetryOrgUsageResponse } from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { OrgUsagePanel } from '@/components/telemetry/org-usage-panel';

export const dynamic = 'force-dynamic';

export default async function TelemetriaPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, TELEMETRY_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const data = await apiGet<TelemetryOrgUsageResponse>('/telemetry/usage/org');

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Uso de la plataforma en {data.orgName ?? 'tu colegio'}: por usuario, por módulo del
        backend y por vista del frontend.
      </p>
      <OrgUsagePanel data={data} />
    </div>
  );
}
