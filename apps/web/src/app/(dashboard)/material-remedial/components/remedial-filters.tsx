'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { Route } from 'next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROUTES } from '@/lib/routes';
import { REMEDIAL_STATUS_OPTIONS, REMEDIAL_TYPE_OPTIONS } from './labels';

/**
 * Filtros del banco de material (tipo / estado). Sincroniza el estado en la URL
 * para que el Server Component refetchee con los query params (sin estado cliente
 * de datos). `nodeId` se respeta si viene en la URL (enlace desde una brecha).
 * `basePath` permite reusar los filtros dentro del hub de evaluación (pestaña
 * Material en `/evaluaciones/[id]/material-remedial`); por defecto, el banco
 * global top-level.
 */
export function RemedialFilters({ basePath = ROUTES.materialRemedial }: { basePath?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentType = searchParams.get('type') ?? '';
  const currentStatus = searchParams.get('status') ?? '';

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== 'all') {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set('page', '1');
      router.push(`${basePath}?${params.toString()}` as Route);
    },
    [router, searchParams, basePath],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={currentType || 'all'} onValueChange={(v) => updateFilter('type', v)}>
        <SelectTrigger className="w-full sm:w-[200px]">
          <SelectValue placeholder="Tipo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los tipos</SelectItem>
          {REMEDIAL_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentStatus || 'all'} onValueChange={(v) => updateFilter('status', v)}>
        <SelectTrigger className="w-full sm:w-[200px]">
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          {REMEDIAL_STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
