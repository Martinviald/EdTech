import Link from 'next/link';
import { Activity } from 'lucide-react';
import type {
  TelemetryOrgUsageResponse,
  TelemetryPlatformOverviewResponse,
} from '@soe/types';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared';
import {
  OrgUsagePanel,
  TelemetryDimensionCard,
  TelemetryKpi,
  formatTelemetryDate,
} from '@/components/telemetry/org-usage-panel';

export const dynamic = 'force-dynamic';

export default async function AdminTelemetriaPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  const selectedOrg = typeof org === 'string' ? org : null;

  const [overview, orgUsage] = await Promise.all([
    apiGet<TelemetryPlatformOverviewResponse>('/telemetry/admin/overview'),
    selectedOrg
      ? apiGet<TelemetryOrgUsageResponse>(`/telemetry/admin/orgs/${selectedOrg}`)
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Uso de la plataforma en {overview.orgCount} colegios con actividad. Elige un colegio para
        ver su detalle por usuario, módulo y vista.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TelemetryKpi label="Colegios activos" value={overview.orgCount} />
        <TelemetryKpi label="Eventos totales" value={overview.totalEvents} />
        <TelemetryKpi label="Usuarios activos" value={overview.uniqueUsers} />
        <TelemetryKpi label="Módulos backend" value={overview.byBackendModule.length} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Uso por colegio</h2>
        {overview.byOrg.length === 0 ? (
          <EmptyState
            title="Sin telemetría todavía"
            description="Aún no hay eventos de uso registrados en ninguna organización."
            icon={Activity}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colegio</TableHead>
                  <TableHead className="text-right">Eventos</TableHead>
                  <TableHead className="text-right">Usuarios</TableHead>
                  <TableHead>Última actividad</TableHead>
                  <TableHead className="w-[120px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.byOrg.map((row) => (
                  <TableRow
                    key={row.orgId}
                    data-state={row.orgId === selectedOrg ? 'selected' : undefined}
                  >
                    <TableCell className="font-medium">{row.orgName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.events.toLocaleString('es-CL')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.users}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTelemetryDate(row.lastSeen)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`${ROUTES.adminTelemetria}?org=${row.orgId}`}
                        className="text-sm text-primary underline-offset-4 hover:underline"
                      >
                        Ver detalle
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <TelemetryDimensionCard
          title="Módulos backend (plataforma)"
          description="Uso agregado por endpoint en todas las organizaciones (api.request)."
          rows={overview.byBackendModule}
          unit="Llamadas"
        />
        <TelemetryDimensionCard
          title="Vistas frontend (plataforma)"
          description="Secciones navegadas agregadas en todas las organizaciones (page.viewed)."
          rows={overview.byFrontendView}
          unit="Vistas"
        />
      </div>

      {orgUsage ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">
            Detalle: {orgUsage.orgName ?? 'Colegio'}
          </h2>
          <OrgUsagePanel data={orgUsage} />
        </section>
      ) : null}
    </div>
  );
}
