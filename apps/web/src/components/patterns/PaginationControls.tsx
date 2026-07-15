'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Button } from '@/components/ui/button';

/**
 * Controles de paginación que escriben `page` en la querystring (H6.4). El
 * `basePath` lo entrega la página servidor que conoce su ruta.
 */
export function PaginationControls({
  page,
  limit,
  total,
  basePath,
}: {
  page: number;
  limit: number;
  total: number;
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const goTo = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(nextPage));
    router.push(`${basePath}?${params.toString()}` as Route);
  };

  if (total <= limit) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex flex-col items-center justify-between gap-3 pt-2 sm:flex-row">
      <p className="text-xs text-muted-foreground">
        Mostrando {from}–{to} de {total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
          Anterior
        </Button>
        <span className="text-xs text-muted-foreground">
          Página {page} de {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => goTo(page + 1)}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
