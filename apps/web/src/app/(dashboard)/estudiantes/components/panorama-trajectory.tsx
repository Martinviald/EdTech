'use client';

// Trayectoria de % de logro del alumno a través de sus evaluaciones. Reusa el
// `ProgressionChart` de resultados (recharts, client-only) vía `next/dynamic` por
// §05-performance: el bundle del gráfico carga bajo demanda y el shell pinta sin él.

import dynamic from 'next/dynamic';
import type { ProgressionPoint, StudentPanoramaAssessment } from '@soe/types';
import { Skeleton } from '@/components/ui/skeleton';

const ProgressionChart = dynamic(
  () =>
    import('../../resultados/components/charts/progression-chart').then((m) => m.ProgressionChart),
  { ssr: false, loading: () => <Skeleton className="h-72 w-full sm:h-80" /> },
);

export function PanoramaTrajectory({ items }: { items: StudentPanoramaAssessment[] }) {
  const points: ProgressionPoint[] = items.map((a) => ({
    assessmentId: a.assessmentId,
    assessmentName: a.assessmentName,
    instrumentName: a.instrumentName,
    administeredAt: a.administeredAt,
    achievement: a.achievement,
    performanceLevel: a.performanceLevel,
  }));

  return <ProgressionChart points={points} />;
}
