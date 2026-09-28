import Link from 'next/link';
import { CalendarRange, ClipboardList, GraduationCap, TriangleAlert } from 'lucide-react';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  PROCESS_KIND_LABELS,
  type AlertSeverity,
  type ComparableOverviewResponse,
  type MeasurementProcessModel,
} from '@soe/types';
import { apiGet } from '@/lib/api';
import { getComparableOverview } from '../data';
import { Card, CardContent } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';
import { CoverageBar } from '../../procesos/components/coverage-bar';
import { ProcessStatusBadge } from '../../procesos/components/process-status-badge';

const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  high: 'graves',
  medium: 'medias',
  low: 'leves',
};

function formatWindow(startsOn: string | null, endsOn: string | null): string | null {
  if (!startsOn && !endsOn) return null;
  const format = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  if (startsOn && endsOn) return `${format(startsOn)} – ${format(endsOn)}`;
  return format((startsOn ?? endsOn) as string);
}

function countBySeverity(alerts: ComparableOverviewResponse['alerts']): [AlertSeverity, number][] {
  const counts = new Map<AlertSeverity, number>();
  for (const alert of alerts) counts.set(alert.severity, (counts.get(alert.severity) ?? 0) + 1);
  return (['high', 'medium', 'low'] as const)
    .map((severity) => [severity, counts.get(severity) ?? 0] as [AlertSeverity, number])
    .filter(([, count]) => count > 0);
}

/**
 * Previsualización del proceso activo, arriba de la barra de filtros.
 *
 * Reemplaza al aviso "Acotado a: …", que sólo decía cuál era el filtro. Acá el
 * usuario entra y ya ve lo que vino a buscar: cuánto se rindió, a cuántos, qué
 * está alertado y qué unidades están peor.
 *
 * NO agrega queries: `getComparableOverview` está cacheado por-request
 * (`React.cache`), así que esta llamada se deduplica con la que ya hace la
 * sección del panorama con el mismo `scopedQuery`.
 */
export async function ProcessPreviewBanner({
  processId,
  scopedQuery,
  clearHref,
}: {
  processId: string;
  scopedQuery: string;
  clearHref: string;
}) {
  let process: MeasurementProcessModel | null = null;
  try {
    process = await apiGet<MeasurementProcessModel>(`/measurement-processes/${processId}`);
  } catch {
    return null;
  }

  const comparable = await getComparableOverview(scopedQuery).catch(() => null);
  const window = formatWindow(process.startsOn, process.endsOn);
  const subtitle = [
    PROCESS_KIND_LABELS[process.kind],
    process.period ? INSTRUMENT_APPLICATION_PERIOD_LABELS[process.period] : null,
    process.academicYear ? `Año ${process.academicYear}` : null,
    window,
  ]
    .filter(Boolean)
    .join(' · ');

  const severities = comparable ? countBySeverity(comparable.alerts) : [];
  // Sólo las que TIENEN severidad. `severity: null` es "no clasificable" —el
  // instrumento no define bandas—, no "está mal": listarla bajo "requieren
  // atención" afirma algo que nadie midió.
  const topUnits = (comparable?.units ?? []).filter((u) => u.severity != null).slice(0, 3);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold">{process.name}</h2>
              <ProcessStatusBadge status={process.status} />
            </div>
            <p className="text-muted-foreground text-xs">{subtitle}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href={ROUTES.proceso(process.id)} className="text-primary hover:underline">
              Ver el proceso
            </Link>
            <Link href={clearHref} className="text-primary hover:underline">
              Ver todos los procesos
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <GraduationCap className="size-3.5" aria-hidden />
              Alumnos evaluados
            </p>
            <p className="text-xl font-semibold">
              {(comparable?.totals.studentsEvaluated ?? process.studentsAssessed).toLocaleString(
                'es-CL',
              )}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <ClipboardList className="size-3.5" aria-hidden />
              Evaluaciones
            </p>
            <p className="text-xl font-semibold">
              {comparable?.totals.assessments ?? process.assessmentCount}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <TriangleAlert className="size-3.5" aria-hidden />
              Alertas
            </p>
            {comparable && comparable.alertsTotal > 0 ? (
              <p className="text-xl font-semibold">
                {comparable.alertsTotal}
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  {severities.map(([s, n]) => `${n} ${SEVERITY_LABELS[s]}`).join(' · ')}
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground text-xl font-semibold">—</p>
            )}
          </div>
        </div>

        {process.coverage && process.coverage.expected > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <CalendarRange className="size-3.5" aria-hidden />
                Cobertura
              </span>
              <span className="text-xs font-medium">
                {process.coverage.complete} de {process.coverage.expected} celdas
              </span>
            </div>
            <CoverageBar totals={process.coverage} />
            {process.scopeDerived && (
              <p className="text-muted-foreground text-2xs">
                Alcance derivado de lo ya cargado: describe lo que se rindió, no lo que se esperaba
                rendir. Este 100% no mide celdas faltantes.
              </p>
            )}
          </div>
        )}

        {topUnits.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs">Unidades que más requieren atención</p>
            <ul className="space-y-1">
              {topUnits.map((unit) => (
                <li key={unit.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium">{unit.instrumentName}</span>
                  {unit.lowestBandShare != null && (
                    <span className="text-muted-foreground text-xs">
                      {Math.round(unit.lowestBandShare)}% en la banda inferior
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
