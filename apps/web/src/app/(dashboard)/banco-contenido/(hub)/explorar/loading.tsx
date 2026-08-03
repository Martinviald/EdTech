import { Skeleton } from '@/components/ui/skeleton';
import { FilterBarSkeleton, TableSkeleton } from '@/components/shared';

// El layout del hub aporta encabezado + tabs; este loading es solo el contenido
// de la tab (selector de alcance + filtros + tabla).
export default function ExplorarLoading() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-[180px]" />
      </div>
      <FilterBarSkeleton />
      <TableSkeleton />
    </>
  );
}
