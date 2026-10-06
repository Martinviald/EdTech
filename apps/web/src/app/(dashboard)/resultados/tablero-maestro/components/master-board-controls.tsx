'use client';

import { useCallback, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  METRIC_LABELS,
  type MasterBoardAcademicYear,
  type MasterBoardTake,
  type MetricKey,
} from '@soe/types';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TopProgressBar } from '@/components/shared/TopProgressBar';
import { ROUTES } from '@/lib/routes';
import {
  buildMasterBoardQuery,
  takeKeyOf,
  takeToFilterValues,
  type MasterBoardFilterValues,
} from '../master-board-filters';
import { assessmentCountLabel, formatTakeWindow, groupTakesByYear } from './take-options';

const METRIC_OPTIONS = Object.keys(METRIC_LABELS) as MetricKey[];

export function MasterBoardControls({
  takes,
  academicYears,
  value,
}: {
  takes: MasterBoardTake[];
  academicYears: MasterBoardAcademicYear[];
  value: MasterBoardFilterValues;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const currentTakeKey = takeKeyOf(value);
  const takesByKey = useMemo(() => new Map(takes.map((take) => [take.key, take])), [takes]);
  const groups = useMemo(() => groupTakesByYear(takes, academicYears), [takes, academicYears]);
  const currentTake = currentTakeKey ? takesByKey.get(currentTakeKey) : undefined;

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
      const take = takesByKey.get(key);
      if (take) navigate(takeToFilterValues(take, value.metric));
    },
    [takesByKey, value.metric, navigate],
  );

  const onMetricChange = useCallback(
    (metric: string) => navigate({ ...value, metric: metric as MetricKey }),
    [value, navigate],
  );

  return (
    <div className="relative flex flex-wrap items-end gap-3">
      <TopProgressBar active={isPending} />
      <div className="flex w-full flex-col gap-1.5 sm:w-auto">
        <label className="text-xs font-medium text-muted-foreground">Toma de evaluaciones</label>
        <Select value={currentTakeKey ?? undefined} onValueChange={onTakeChange}>
          <SelectTrigger className="w-full sm:w-[340px]" aria-label="Toma de evaluaciones">
            <SelectValue placeholder="Selecciona una toma">
              {currentTake ? <span className="truncate">{currentTake.label}</span> : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {takes.length === 0 ? (
              <SelectItem value="__none" disabled>
                No hay tomas con datos
              </SelectItem>
            ) : (
              groups.map((group) => (
                <SelectGroup key={group.academicYearId}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.takes.map((take) => (
                    <SelectItem key={take.key} value={take.key}>
                      <TakeOption take={take} />
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="flex w-full flex-col gap-1.5 sm:w-auto">
        <label className="text-xs font-medium text-muted-foreground">Métrica</label>
        <Select
          value={value.metric ?? METRIC_OPTIONS[0]}
          onValueChange={onMetricChange}
          disabled={METRIC_OPTIONS.length <= 1}
        >
          <SelectTrigger className="w-full sm:w-[200px]" aria-label="Métrica">
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

function TakeOption({ take }: { take: MasterBoardTake }) {
  const dateWindow = formatTakeWindow(take);
  return (
    <span className="flex flex-col gap-0.5 py-0.5">
      <span className="font-medium">{take.label}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {dateWindow ? <span>{dateWindow}</span> : null}
        <span>{assessmentCountLabel(take.assessmentCount)}</span>
        {!take.hasResults ? <StatusBadge tone="neutral">Sin resultados</StatusBadge> : null}
        {take.partial ? <StatusBadge tone="warning">Parcial</StatusBadge> : null}
      </span>
    </span>
  );
}
