'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { PERFORMANCE_LEVELS, type PerformanceLevel } from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PERFORMANCE_LEVEL_LABELS } from './performance-level';

const ALL = '__all__';

/**
 * Filtro por nivel de desempeño para la clasificación (H6.4). Escribe
 * `performanceLevel` en la querystring y reinicia la página.
 */
export function PerformanceLevelFilter({
  value,
  basePath,
}: {
  value: PerformanceLevel | undefined;
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next && next !== ALL) {
      params.set('performanceLevel', next);
    } else {
      params.delete('performanceLevel');
    }
    params.delete('page');
    const qs = params.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route);
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Nivel de desempeño</span>
      <Select value={value ?? ALL} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-[200px]">
          <SelectValue placeholder="Todos los niveles" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los niveles</SelectItem>
          {PERFORMANCE_LEVELS.map((level) => (
            <SelectItem key={level} value={level}>
              {PERFORMANCE_LEVEL_LABELS[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
