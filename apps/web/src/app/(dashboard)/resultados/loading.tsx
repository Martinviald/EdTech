import { Skeleton } from '@/components/ui/skeleton';
import { CompactFilterBarSkeleton, KpiGridSkeleton, CardSkeleton } from '@/components/shared';

// El layout de resultados aporta PageContainer + las tabs; este loading es solo
// el contenido de la tab (encabezado + filtros + secciones).
export default function ResultadosLoading() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <CompactFilterBarSkeleton />
      <KpiGridSkeleton />
      <CardSkeleton />
    </>
  );
}
