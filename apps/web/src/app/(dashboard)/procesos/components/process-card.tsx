import Link from 'next/link';
import { CalendarRange, ClipboardList, Users } from 'lucide-react';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  PROCESS_KIND_LABELS,
  type MeasurementProcessModel,
} from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';
import { CoverageBar } from './coverage-bar';
import { ProcessStatusBadge } from './process-status-badge';

function formatWindow(startsOn: string | null, endsOn: string | null): string | null {
  if (!startsOn && !endsOn) return null;
  const format = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  if (startsOn && endsOn) return `${format(startsOn)} – ${format(endsOn)}`;
  return format((startsOn ?? endsOn) as string);
}

export function ProcessCard({ process }: { process: MeasurementProcessModel }) {
  const window = formatWindow(process.startsOn, process.endsOn);
  const subtitle = [
    PROCESS_KIND_LABELS[process.kind],
    process.period ? INSTRUMENT_APPLICATION_PERIOD_LABELS[process.period] : null,
    process.academicYear,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card className="hover:border-primary/40 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">
              <Link href={ROUTES.proceso(process.id)} className="hover:underline">
                {process.name}
              </Link>
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">{subtitle}</p>
          </div>
          <ProcessStatusBadge status={process.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {process.coverage ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Cobertura</span>
              <span className="font-medium">
                {process.coverage.complete} de {process.coverage.expected} celdas
              </span>
            </div>
            <CoverageBar totals={process.coverage} />
            {process.scopeDerived && (
              <p className="text-muted-foreground text-2xs">
                Alcance derivado de lo ya cargado: no mide celdas faltantes.
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Sin alcance declarado: define cursos y asignaturas para medir la cobertura.
          </p>
        )}

        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5">
            <ClipboardList className="size-3.5" aria-hidden />
            {process.assessmentCount} evaluaciones
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden />
            {process.studentsAssessed} alumnos evaluados
          </span>
          {window && (
            <span className="flex items-center gap-1.5">
              <CalendarRange className="size-3.5" aria-hidden />
              {window}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
