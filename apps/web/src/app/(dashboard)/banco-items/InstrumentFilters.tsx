'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import type { Route } from 'next';
import { Input } from '@/components/ui/input';
import { ROUTES } from '@/lib/routes';
import { TopProgressBar } from '@/components/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TYPE_OPTIONS = [
  { value: 'dia', label: 'DIA' },
  { value: 'simce', label: 'SIMCE' },
  { value: 'paes', label: 'PAES' },
  { value: 'cambridge_mock', label: 'Cambridge' },
  { value: 'aptus', label: 'Aptus' },
  { value: 'desafio', label: 'Desafio' },
  { value: 'pal', label: 'PAL' },
  { value: 'custom', label: 'Personalizado' },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Borrador' },
  { value: 'published', label: 'Publicado' },
  { value: 'archived', label: 'Archivado' },
];

export function InstrumentFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // La transición mantiene visible el listado previo mientras llega el nuevo y
  // expone `isPending` para la barra de progreso (sin flash de skeleton).
  const [isPending, startTransition] = useTransition();

  const currentType = searchParams.get('type') ?? '';
  const currentStatus = searchParams.get('status') ?? '';
  const currentYear = searchParams.get('year') ?? '';

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== 'all') {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set('page', '1');
      startTransition(() => {
        router.push(`${ROUTES.bancoItems}?${params.toString()}` as Route);
      });
    },
    [router, searchParams],
  );

  return (
    <div className="relative flex flex-wrap items-center gap-3">
      <TopProgressBar active={isPending} />
      <Select value={currentType || 'all'} onValueChange={(v) => updateFilter('type', v)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Tipo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los tipos</SelectItem>
          {TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentStatus || 'all'} onValueChange={(v) => updateFilter('status', v)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="number"
        placeholder="Ano"
        className="w-[100px]"
        value={currentYear}
        min={2000}
        max={2100}
        onChange={(e) => updateFilter('year', e.target.value)}
      />
    </div>
  );
}
