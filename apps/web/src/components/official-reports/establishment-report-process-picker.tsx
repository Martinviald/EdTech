'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { INSTRUMENT_APPLICATION_PERIOD_LABELS, type MeasurementProcessModel } from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TopProgressBar } from '@/components/shared/TopProgressBar';

export type EstablishmentProcessOption = Pick<
  MeasurementProcessModel,
  'id' | 'name' | 'academicYear' | 'period'
>;

function describe(process: EstablishmentProcessOption): string {
  const details = [
    process.period ? INSTRUMENT_APPLICATION_PERIOD_LABELS[process.period] : null,
    process.academicYear ? String(process.academicYear) : null,
  ].filter(Boolean);
  return details.length > 0 ? `${process.name} (${details.join(' · ')})` : process.name;
}

/**
 * Selector del proceso de medición del informe del establecimiento. El informe se
 * calcula por proceso (nunca por año), así que elegir uno navega con `processId`.
 */
export function EstablishmentReportProcessPicker({
  processes,
  value,
  basePath,
}: {
  processes: EstablishmentProcessOption[];
  value: string | undefined;
  basePath: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onChange = (processId: string) => {
    const params = new URLSearchParams({ processId });
    startTransition(() => router.push(`${basePath}?${params.toString()}` as Route));
  };

  return (
    <div className="relative flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 print:hidden">
      <TopProgressBar active={isPending} />
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:min-w-[320px]">
        <span className="text-xs font-medium text-muted-foreground">Proceso de medición</span>
        <Select value={value} onValueChange={onChange} disabled={processes.length === 0}>
          <SelectTrigger className="w-full sm:w-[360px]">
            <SelectValue
              placeholder={
                processes.length === 0 ? 'No hay procesos de medición' : 'Elige un proceso'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {processes.map((process) => (
              <SelectItem key={process.id} value={process.id}>
                {describe(process)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
