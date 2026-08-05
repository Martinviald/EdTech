import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, Inbox, TrendingDown, TrendingUp } from 'lucide-react';
import type { ComparableUnitSummary, UnitSeverity } from '@soe/types';
import { EmptyState } from '@/components/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ROUTES } from '@/lib/routes';
import { formatAchievement } from './performance-level';

/**
 * La vista central del panorama: una fila por unidad comparable, ordenada por
 * severidad.
 *
 * Reemplaza al "% de logro global" que #1C retiró. Cada número de esta tabla vive
 * dentro de UN instrumento, así que sí se puede leer — y comparar filas entre sí no
 * es promediarlas: para eso está la columna del baseline, que enfrenta cada unidad
 * contra su propio comparable (mismo instrumento el año anterior, o el momento
 * anterior del ciclo).
 */

const SEVERITY_DOT: Record<UnitSeverity, string> = {
  high: 'bg-destructive',
  medium: 'bg-warning',
  low: 'bg-success',
};

const SEVERITY_LABEL: Record<UnitSeverity, string> = {
  high: 'Requiere atención',
  medium: 'En observación',
  low: 'Sin alertas',
};

const PERIOD_LABEL: Record<string, string> = {
  diagnostico: 'Diagnóstico',
  intermedio: 'Monitoreo',
  cierre: 'Cierre',
};

/**
 * El drill de una unidad. Con una sola aplicación se entra directo a su informe; con
 * varias, se acota el panorama a ese instrumento (que es exactamente lo que vuelve
 * agregable el resto de las vistas).
 */
function unitHref(unit: ComparableUnitSummary): Route {
  if (unit.assessmentIds.length === 1) {
    return ROUTES.evaluacionResultados(unit.assessmentIds[0]!);
  }
  return `${ROUTES.resultados}?instrumentId=${unit.instrumentId}` as Route;
}

function DeltaChip({ unit }: { unit: ComparableUnitSummary }) {
  const delta = unit.baseline?.deltaPp;
  if (delta == null) return <span className="text-muted-foreground">—</span>;

  const dropped = delta < 0;
  const Icon = dropped ? TrendingDown : TrendingUp;
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${
        dropped ? 'text-destructive' : 'text-success'
      }`}
      title={`Comparado con ${unit.baseline?.label ?? 'su referencia'}`}
    >
      <Icon className="size-3.5 shrink-0" />
      {dropped ? '' : '+'}
      {delta.toFixed(1)} pp
    </span>
  );
}

export function ComparableUnitsTable({ units }: { units: ComparableUnitSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evaluaciones comparables</CardTitle>
        <CardDescription>
          Una fila por instrumento. El % de logro sólo se puede leer dentro de una misma evaluación,
          así que no hay un promedio que las resuma: las más urgentes van primero.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {units.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Aún no hay evaluaciones con resultados"
            description="Cuando importes resultados aparecerán aquí, ordenadas por urgencia."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <span className="sr-only">Severidad</span>
                  </TableHead>
                  <TableHead>Evaluación</TableHead>
                  <TableHead className="hidden md:table-cell">Asignatura</TableHead>
                  <TableHead className="hidden md:table-cell">Nivel</TableHead>
                  <TableHead className="hidden lg:table-cell">Momento</TableHead>
                  <TableHead className="text-right">Alumnos</TableHead>
                  <TableHead className="text-right">% Logro</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Nivel más bajo</TableHead>
                  <TableHead className="text-right">vs. comparable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map((unit) => (
                  <TableRow key={unit.key}>
                    <TableCell>
                      {unit.severity ? (
                        <span
                          className={`block size-2.5 rounded-full ${SEVERITY_DOT[unit.severity]}`}
                          title={SEVERITY_LABEL[unit.severity]}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={unitHref(unit)}
                        className="group inline-flex items-center gap-1.5 hover:text-primary"
                      >
                        <span>
                          {unit.instrumentName}
                          <span className="block text-xs font-normal text-muted-foreground md:hidden">
                            {[unit.subjectName, unit.gradeName].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <ArrowRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {unit.subjectName ?? '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{unit.gradeName ?? '—'}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {unit.applicationPeriod
                        ? (PERIOD_LABEL[unit.applicationPeriod] ?? unit.applicationPeriod)
                        : '—'}
                      {unit.year ? (
                        <span className="block text-xs text-muted-foreground">{unit.year}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">{unit.studentsAssessed}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatAchievement(unit.averageAchievement)}
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell">
                      {unit.lowestBandShare == null ? '—' : `${unit.lowestBandShare.toFixed(0)}%`}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeltaChip unit={unit} />
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
