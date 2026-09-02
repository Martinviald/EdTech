'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABELS,
} from '@soe/types';
import { FilterBar, type FilterField } from '@/components/shared';
import { Button } from '@/components/ui/button';

/**
 * Filtros de la bandeja de plataforma. Viven en la URL, no en estado local: así
 * un enlace a "los bugs sin revisar del colegio X" se puede pegar en un chat y
 * abre exactamente esa vista.
 */
export function FeedbackFilters({
  basePath,
  orgs,
}: {
  basePath: string;
  orgs: ReadonlyArray<{ id: string; name: string; count: number }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams?.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      // Cambiar un filtro invalida la página en la que estabas.
      next.delete('page');
      const qs = next.toString();
      router.push((qs ? `${basePath}?${qs}` : basePath) as Route);
    },
    [router, searchParams, basePath],
  );

  const status = searchParams?.get('status') ?? '';
  const type = searchParams?.get('type') ?? '';
  const orgId = searchParams?.get('orgId') ?? '';
  const hasFilters = Boolean(status || type || orgId);

  const fields: FilterField[] = [
    {
      key: 'status',
      label: 'Estado',
      placeholder: 'Todos los estados',
      value: status,
      options: FEEDBACK_STATUSES.map((s) => ({ id: s, label: FEEDBACK_STATUS_LABELS[s] })),
      onChange: (value) => setParam('status', value),
    },
    {
      key: 'type',
      label: 'Tipo',
      placeholder: 'Todos los tipos',
      value: type,
      options: FEEDBACK_TYPES.map((t) => ({ id: t, label: FEEDBACK_TYPE_LABELS[t] })),
      onChange: (value) => setParam('type', value),
    },
    {
      key: 'orgId',
      label: 'Colegio',
      placeholder: 'Todos los colegios',
      value: orgId,
      // Sólo colegios CON comentarios: ofrecer los demás sería ofrecer vacíos.
      options: orgs.map((org) => ({ id: org.id, label: `${org.name} (${org.count})` })),
      hidden: orgs.length < 2,
      onChange: (value) => setParam('orgId', value),
    },
  ];

  return (
    <FilterBar
      fields={fields}
      actions={
        hasFilters ? (
          <Button variant="ghost" size="sm" onClick={() => router.push(basePath as Route)}>
            Limpiar filtros
          </Button>
        ) : null
      }
    />
  );
}
