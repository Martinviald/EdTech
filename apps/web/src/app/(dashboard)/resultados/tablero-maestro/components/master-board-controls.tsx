'use client';

import { useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { METRIC_LABELS, type MasterBoardTake, type MetricKey } from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TopProgressBar } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import {
  buildMasterBoardQuery,
  takeKeyOf,
  takeToFilterValues,
  type MasterBoardFilterValues,
} from '../master-board-filters';

const METRIC_OPTIONS = Object.keys(METRIC_LABELS) as MetricKey[];

export function MasterBoardControls({
  takes,
  value,
}: {
  takes: MasterBoardTake[];
  value: MasterBoardFilterValues;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const currentTakeKey = takeKeyOf(value);

  const navigate = useCallback(
    (next: MasterBoardFilterValues) => {
      const queryString = buildMasterBoardQuery(next);
      startTransition(() => {
        router.push(`${ROUTES.resultadosTableroMaestro}${queryString}` as Route);
      });
    },
    [router],
  );

  const onTakeChange = useCallback(
    (key: string) => {
      const take = takes.find((candidate) => candidate.key === key);
      if (take) navigate(takeToFilterValues(take, value.metric));
    },
    [takes, value.metric, navigate],
  );

  const onMetricChange = useCallback(
    (metric: string) => navigate({ ...value, metric: metric as MetricKey }),
    [value, navigate],
  );

  return (
    <div className="relative flex flex-wrap items-end gap-3">
      <TopProgressBar active={isPending} />
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Toma de evaluaciones</label>
        <Select value={currentTakeKey ?? undefined} onValueChange={onTakeChange}>
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="Selecciona una toma" />
          </SelectTrigger>
          <SelectContent>
            {takes.length === 0 ? (
              <SelectItem value="__none" disabled>
                No hay tomas con datos
              </SelectItem>
            ) : (
              takes.map((take) => (
                <SelectItem key={take.key} value={take.key}>
                  {take.label} · {take.assessmentCount}{' '}
                  {take.assessmentCount === 1 ? 'evaluación' : 'evaluaciones'}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Métrica</label>
        <Select
          value={value.metric ?? METRIC_OPTIONS[0]}
          onValueChange={onMetricChange}
          disabled={METRIC_OPTIONS.length <= 1}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRIC_OPTIONS.map((metric) => (
              <SelectItem key={metric} value={metric}>
                {METRIC_LABELS[metric]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
