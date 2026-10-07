import type {
  AssessmentComparisonCohort,
  AssessmentComparisonResponse,
  AssessmentComparisonSide,
  PerformanceBandDistributionBucket,
} from '@soe/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertCallout } from '@/components/shared/AlertCallout';
import { MetricsGroup } from '@/components/shared/MetricsGroup';
import { nodeTypeLabel } from '@/lib/taxonomy-labels';
import { cn } from '@/lib/utils';
import { DistributionBar } from '../../resultados/components/distribution-bar';
import { CohortToggle } from './cohort-toggle';
import { formatDeltaPp, formatPct } from './comparison-format';

const DIFFICULTY_NOTICE =
  'Instrumentos distintos; la diferencia puede deberse a la dificultad de la prueba';

function bucketsOf(side: AssessmentComparisonSide): PerformanceBandDistributionBucket[] {
  const cells = new Map(side.bandDistribution.map((cell) => [cell.bandKey, cell]));
  return side.bands.map((band) => ({
    key: band.key,
    label: band.label,
    order: band.order,
    color: band.color ?? null,
    count: cells.get(band.key)?.count ?? 0,
    percentage: cells.get(band.key)?.percentage ?? 0,
  }));
}

function bandLabels(side: AssessmentComparisonSide): Map<string, string> {
  return new Map(side.bands.map((band) => [band.key, band.label]));
}

function deltaClass(value: number | null): string {
  if (value === null || Math.abs(value) < 0.05) return 'text-muted-foreground';
  return value > 0 ? 'text-success' : 'text-destructive';
}

function SideDistribution({ role, side }: { role: string; side: AssessmentComparisonSide }) {
  const title = `${role} · ${side.assessmentName} (N = ${side.bandStudents})`;
  if (side.bands.length === 0) {
    return (
      <Card hover={false}>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            El instrumento de esta evaluación no define niveles de desempeño.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <DistributionBar
      distribution={[]}
      bands={side.bands}
      bandDistribution={bucketsOf(side)}
      title={title}
    />
  );
}

function MovementSection({ data }: { data: AssessmentComparisonResponse }) {
  if (data.pairedStudents === 0 || data.transitions.length === 0) return null;
  const fromLabels = bandLabels(data.base);
  const toLabels = bandLabels(data.comparison);

  return (
    <Card hover={false}>
      <CardHeader>
        <CardTitle className="text-base">Movimiento entre niveles</CardTitle>
        <CardDescription>
          Estudiantes que rindieron ambas evaluaciones, con el nivel de cada instrumento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.movement ? (
          <MetricsGroup
            metrics={[
              { label: 'Subieron de nivel', value: String(data.movement.improved) },
              { label: 'Se mantuvieron', value: String(data.movement.same) },
              { label: 'Bajaron de nivel', value: String(data.movement.declined) },
            ]}
          />
        ) : (
          <AlertCallout tone="info">
            Los instrumentos tienen distinto número de niveles, así que no se puede decir quién
            subió o bajó. La tabla muestra cómo se distribuyen entre los niveles de cada uno.
          </AlertCallout>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nivel en la base</TableHead>
                <TableHead>Nivel en la comparada</TableHead>
                <TableHead className="text-right">Estudiantes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.transitions.map((transition) => (
                <TableRow key={`${transition.fromBandKey}-${transition.toBandKey}`}>
                  <TableCell>
                    {fromLabels.get(transition.fromBandKey) ?? transition.fromBandKey}
                  </TableCell>
                  <TableCell>
                    {toLabels.get(transition.toBandKey) ?? transition.toBandKey}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{transition.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function AchievementSection({ data }: { data: AssessmentComparisonResponse }) {
  const { base, comparison } = data;
  const delta =
    base.achievementPct === null || comparison.achievementPct === null
      ? null
      : comparison.achievementPct - base.achievementPct;
  const hintOf = (side: AssessmentComparisonSide) =>
    side.achievementPct === null
      ? 'Sin puntaje por estudiante en esta cohorte'
      : `N = ${side.achievementStudents}`;

  return (
    <Card hover={false}>
      <CardHeader>
        <CardTitle className="text-base">% de logro</CardTitle>
        <CardDescription>Puntaje obtenido sobre el puntaje máximo de cada cohorte.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MetricsGroup
          metrics={[
            { label: 'Base', value: formatPct(base.achievementPct), hint: hintOf(base) },
            {
              label: 'Comparada',
              value: formatPct(comparison.achievementPct),
              hint: hintOf(comparison),
            },
            { label: 'Diferencia', value: formatDeltaPp(delta) },
          ]}
        />
        {base.instrumentId !== comparison.instrumentId ? (
          <AlertCallout tone="warning">{DIFFICULTY_NOTICE}</AlertCallout>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NodesSection({ data }: { data: AssessmentComparisonResponse }) {
  return (
    <Card hover={false}>
      <CardHeader>
        <CardTitle className="text-base">Logro por eje y habilidad</CardTitle>
        <CardDescription>
          Sólo los nodos evaluados en ambas evaluaciones, sobre todos los evaluados de tus cursos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Las evaluaciones no comparten ejes ni habilidades etiquetados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nodo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Comparada</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.nodes.map((node) => (
                  <TableRow key={node.nodeId}>
                    <TableCell className="font-medium">{node.nodeName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {nodeTypeLabel(node.nodeType) ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(node.baseAchievementPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(node.comparisonAchievementPct)}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', deltaClass(node.deltaPp))}>
                      {formatDeltaPp(node.deltaPp)}
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

export function ComparisonResults({
  data,
  requestedCohort,
}: {
  data: AssessmentComparisonResponse;
  requestedCohort: AssessmentComparisonCohort;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Comparación de resultados</h2>
        <CohortToggle value={requestedCohort} />
      </div>

      {data.fellBackToAll ? (
        <AlertCallout tone="warning">
          Ningún estudiante de tus cursos rindió ambas evaluaciones, así que se comparan todos los
          evaluados de cada una.
        </AlertCallout>
      ) : null}

      <MetricsGroup
        metrics={[
          {
            label: 'Evaluados en la base',
            value: String(data.base.studentsAssessed),
            hint: data.base.assessmentName,
          },
          {
            label: 'Evaluados en la comparada',
            value: String(data.comparison.studentsAssessed),
            hint: data.comparison.assessmentName,
          },
          {
            label: 'Pareados',
            value: String(data.pairedStudents),
            hint: 'Rindieron ambas evaluaciones',
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SideDistribution role="Base" side={data.base} />
        <SideDistribution role="Comparada" side={data.comparison} />
      </div>

      <MovementSection data={data} />
      <AchievementSection data={data} />
      <NodesSection data={data} />
    </div>
  );
}
