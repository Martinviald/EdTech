import type { UserRole } from '@soe/types';
import type { TelemetryDimensionRow, TelemetryOrgUsageResponse, TelemetryUserUsageRow } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared';
import { Activity } from 'lucide-react';
import { ROLE_LABELS } from '@/components/layout/nav-items';

export function formatTelemetryDate(value: string | null): string {
  if (!value) return '—';
  return value.replace('T', ' ').slice(0, 16);
}

function roleLabel(role: string | null): string {
  if (!role) return '—';
  return ROLE_LABELS[role as UserRole] ?? role;
}

export function TelemetryKpi({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString('es-CL')}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function UsageBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full min-w-[60px] overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TelemetryDimensionCard({
  title,
  description,
  rows,
  unit,
}: {
  title: string;
  description: string;
  rows: TelemetryDimensionRow[];
  unit: string;
}) {
  const max = rows.reduce((acc, row) => Math.max(acc, row.events), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin datos en el período.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-[120px] text-right">{unit}</TableHead>
                <TableHead className="w-[80px] text-right">Usuarios</TableHead>
                <TableHead className="w-[160px]">Uso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.events.toLocaleString('es-CL')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.users}
                  </TableCell>
                  <TableCell>
                    <UsageBar value={row.events} max={max} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function UsersTable({ rows }: { rows: TelemetryUserUsageRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Uso por usuario</CardTitle>
        <p className="text-sm text-muted-foreground">
          Quién usa la plataforma y cuánto. Las acciones API incluyen tráfico automático
          (polls/refetch en segundo plano), no solo uso deliberado.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividad en el período.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Vistas web</TableHead>
                  <TableHead className="text-right">Acciones API</TableHead>
                  <TableHead className="text-right">Tools MCP</TableHead>
                  <TableHead>Última actividad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.userId ?? row.email ?? 'anon'}>
                    <TableCell className="font-medium">
                      {row.name ?? '—'}
                      {row.email ? (
                        <span className="ml-1 text-xs text-muted-foreground">{row.email}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{roleLabel(row.role)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.events.toLocaleString('es-CL')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.pageViews}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.apiCalls}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.mcpCalls}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTelemetryDate(row.lastSeen)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function OrgUsagePanel({ data }: { data: TelemetryOrgUsageResponse }) {
  if (data.totalEvents === 0) {
    return (
      <EmptyState
        title="Sin telemetría en el período"
        description="Todavía no hay eventos de uso registrados para este colegio."
        icon={Activity}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TelemetryKpi label="Eventos totales" value={data.totalEvents} />
        <TelemetryKpi label="Usuarios activos" value={data.uniqueUsers} />
        <TelemetryKpi label="Módulos backend" value={data.byBackendModule.length} />
        <TelemetryKpi label="Vistas frontend" value={data.byFrontendView.length} />
      </div>

      <UsersTable rows={data.byUser} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TelemetryDimensionCard
          title="Módulos backend"
          description="Uso por endpoint (2.º segmento de la ruta), del evento api.request."
          rows={data.byBackendModule}
          unit="Llamadas"
        />
        <TelemetryDimensionCard
          title="Vistas del frontend"
          description="Secciones navegadas, del evento page.viewed."
          rows={data.byFrontendView}
          unit="Vistas"
        />
      </div>

      {data.byMcpTool.length > 0 ? (
        <TelemetryDimensionCard
          title="Tools MCP"
          description="Invocaciones de tools del servidor MCP analítico (mcp.tool_invoked)."
          rows={data.byMcpTool}
          unit="Invocaciones"
        />
      ) : null}
    </div>
  );
}
