import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/shared';

// El layout del hub aporta encabezado + tabs; este loading es solo el contenido
// de la tab (fila de filtros + listado).
export default function BancoItemsLoading() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-10 w-[160px]" />
          <Skeleton className="h-10 w-[180px]" />
          <Skeleton className="h-10 w-[160px]" />
          <Skeleton className="h-10 w-[130px]" />
          <Skeleton className="h-10 w-[160px]" />
        </div>
        <Skeleton className="h-10 w-[160px]" />
      </div>
      <TableSkeleton />
    </>
  );
}
