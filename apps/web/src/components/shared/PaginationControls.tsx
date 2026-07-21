'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import type { Route } from 'next';
import { Button } from '@/components/ui/button';
import { TopProgressBar } from './TopProgressBar';

/**
 * Controles de paginación que escriben `page` en la querystring (H6.4). El
 * `basePath` lo entrega la página servidor que conoce su ruta. La transición
 * mantiene visible la página previa mientras llega la siguiente (sin flash de
 * skeleton) — mismo patrón que `FilterBar`/`InstrumentFilters`, ver
 * .claude/rules/frontend/07-navigation-reactivity.md.
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
  const [isPending, startTransition] = useTransition();
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const goTo = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(nextPage));
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}` as Route);
    });
  };

  if (total <= limit) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="relative flex flex-col items-center justify-between gap-3 pt-2 sm:flex-row">
      <TopProgressBar active={isPending} />
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
