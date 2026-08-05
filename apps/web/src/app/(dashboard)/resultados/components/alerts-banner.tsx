import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, CircleCheck, TriangleAlert } from 'lucide-react';
import type { DashboardAlert } from '@soe/types';
import { EmptyState } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';

/**
 * Las alertas del panorama, con salida.
 *
 * Antes eran una lista pasiva: un `<li>` con borde de color. El payload YA traía
 * `contextId` (el curso o la habilidad señalada) y la UI no lo usaba para nada, así
 * que enterarse de un problema y poder ir a verlo eran dos cosas distintas.
 */

const TONE: Record<DashboardAlert['severity'], string> = {
  high: 'border-l-destructive bg-destructive/10',
  medium: 'border-l-warning bg-warning/10',
  low: 'border-l-info bg-info/10',
};

/** Cuántas alertas se muestran antes de plegar el resto. */
const VISIBLE_LIMIT = 4;

/**
 * A dónde lleva cada alerta. `contextId` significa cosas distintas según la familia
 * —un curso, un nodo de taxonomía, un ítem o una evaluación—, y por eso el backend
 * manda `contextKind`: sin él, la UI tendría que re-derivar el significado del id a
 * partir del tipo de alerta, y ese mapeo se desincroniza en cuanto se agrega un tipo.
 */
function alertHref(alert: DashboardAlert): Route | null {
  if (!alert.contextId) return null;
  const unit = alert.unitKey ? `&instrumentId=${alert.unitKey}` : '';
  switch (alert.contextKind) {
    case 'class_group':
      return `${ROUTES.resultadosClasificacion}?classGroupId=${alert.contextId}${unit}` as Route;
    case 'taxonomy_node':
      return `${ROUTES.resultadosDimensiones}?nodeId=${alert.contextId}${unit}` as Route;
    case 'assessment':
      return ROUTES.evaluacionResultados(alert.contextId);
    case 'item':
      return alert.unitKey
        ? (`${ROUTES.resultadosDimensiones}?instrumentId=${alert.unitKey}` as Route)
        : null;
    default:
      return null;
  }
}

export function AlertsBanner({ alerts }: { alerts: DashboardAlert[] }) {
  const bySeverity = [...alerts].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );
  const visible = bySeverity.slice(0, VISIBLE_LIMIT);
  const hidden = bySeverity.length - visible.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <TriangleAlert className="size-4 text-warning" />
          Requiere atención
          {alerts.length > 0 ? (
            <span className="text-sm font-normal text-muted-foreground">({alerts.length})</span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <EmptyState
            tone="success"
            icon={CircleCheck}
            title="Sin alertas"
            description="Todos los cursos y habilidades del alcance están sobre los umbrales."
          />
        ) : (
          <div className="space-y-2">
            {visible.map((alert, idx) => {
              const href = alertHref(alert);
              return (
                <div
                  key={`${alert.type}-${alert.contextId ?? idx}`}
                  className={`flex flex-col gap-2 rounded-md border-l-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${TONE[alert.severity]}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{alert.message}</p>
                    {alert.unitLabel ? (
                      <p className="text-xs text-muted-foreground">{alert.unitLabel}</p>
                    ) : null}
                  </div>
                  {href ? (
                    <Button variant="outline" size="sm" asChild className="shrink-0">
                      <Link href={href}>
                        Ver detalle
                        <ArrowRight className="ml-1.5 size-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {hidden > 0 ? (
              <p className="pt-1 text-xs text-muted-foreground">
                {hidden} {hidden === 1 ? 'alerta más' : 'alertas más'} en el alcance actual. Acota
                los filtros para revisarlas.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function severityRank(severity: DashboardAlert['severity']): number {
  return severity === 'high' ? 0 : severity === 'medium' ? 1 : 2;
}
