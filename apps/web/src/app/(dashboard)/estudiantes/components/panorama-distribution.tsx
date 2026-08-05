import { Layers } from 'lucide-react';
import type { StudentPanoramaDistribution } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCallout } from '@/components/shared';
import { DistributionBar } from '../../resultados/components/distribution-bar';

const TITLE = 'Distribución por nivel de desempeño';

export function PanoramaDistribution({
  distribution,
}: {
  distribution: StudentPanoramaDistribution;
}) {
  if (distribution.kind === 'band') {
    return (
      <DistributionBar
        distribution={[]}
        bands={distribution.bands}
        bandDistribution={distribution.buckets}
        title={TITLE}
      />
    );
  }

  if (distribution.kind === 'level') {
    return <DistributionBar distribution={distribution.buckets} title={TITLE} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        {distribution.kind === 'mixed' ? (
          <AlertCallout tone="info" title="No se puede clasificar en un solo gráfico" icon={Layers}>
            Las evaluaciones de este estudiante usan {distribution.scaleCount} escalas de logro
            distintas. Agruparlas en una sola distribución mezclaría niveles que no significan lo
            mismo. Revisa el desempeño por evaluación en la tabla de abajo.
          </AlertCallout>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ninguna de sus evaluaciones tiene un nivel de desempeño asignado.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
