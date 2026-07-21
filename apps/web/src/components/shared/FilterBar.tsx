'use client';

import type { ReactNode } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { TopProgressBar } from './TopProgressBar';

/** Valor centinela para la opción "todos" (Radix Select no admite value vacío). */
const ALL = '__all__';

export type FilterOption = { id: string; label: string };

type BaseFilterField = {
  /** Clave estable para React y para identificar el campo. */
  key: string;
  label: string;
  /** Oculta el campo (p. ej. cuando no hay opciones que ofrecer). */
  hidden?: boolean;
};

/** Campo con un `Select` estándar de un solo valor. */
export type SelectFilterField = BaseFilterField & {
  placeholder: string;
  value: string | undefined;
  options: readonly FilterOption[];
  /** Recibe el id elegido, o `''` cuando se elige la opción "todos". */
  onChange: (value: string) => void;
};

/** Campo con un control arbitrario (multi-select, rango, etc.). */
export type CustomFilterField = BaseFilterField & { control: ReactNode };

export type FilterField = SelectFilterField | CustomFilterField;

interface FilterBarProps {
  fields: readonly FilterField[];
  /** Acciones al final de la barra (p. ej. un botón "Limpiar filtros"). */
  actions?: ReactNode;
  /**
   * `row` (por defecto): una fila que envuelve, cada campo crece para llenar el
   * ancho. `grid`: grilla responsiva de varias filas, para muchos filtros.
   */
  layout?: 'row' | 'grid';
  /** Muestra una barra de progreso fina arriba mientras se re-filtra (el contenido previo se mantiene). */
  pending?: boolean;
  className?: string;
}

/**
 * Barra de filtros genérica. Cada campo es un `Select` estándar o un control
 * custom (`control`). En `row` los campos ocupan todo el ancho (`flex-1`); en
 * `grid` se distribuyen en una grilla responsiva. La opción "todos" de los
 * selects se maneja internamente: el consumidor recibe `''` al elegirla.
 */
export function FilterBar({
  fields,
  actions,
  layout = 'row',
  pending = false,
  className,
}: FilterBarProps) {
  const visible = fields.filter((field) => !field.hidden);
  const isGrid = layout === 'grid';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-primary/20 bg-primary/5 p-4',
        className,
      )}
    >
      <TopProgressBar active={pending} position="bottom" />
      <div
        className={cn(
          isGrid
            ? 'grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            : 'flex flex-wrap items-end gap-3',
        )}
      >
        {visible.map((field) => (
          <FilterFieldCell key={field.key} field={field} isGrid={isGrid} />
        ))}
        {actions && !isGrid ? <div className="flex flex-none items-end">{actions}</div> : null}
      </div>
      {actions && isGrid ? <div className="mt-3 flex justify-end">{actions}</div> : null}
    </div>
  );
}

function FilterFieldCell({ field, isGrid }: { field: FilterField; isGrid: boolean }) {
  return (
    <div className={cn('flex flex-col gap-1.5', isGrid ? 'w-full' : 'min-w-[180px] flex-1')}>
      <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
      {'control' in field ? field.control : <FilterSelectInput field={field} />}
    </div>
  );
}

function FilterSelectInput({ field }: { field: SelectFilterField }) {
  return (
    <Select
      value={field.value || ALL}
      onValueChange={(next) => field.onChange(next === ALL ? '' : next)}
    >
      <SelectTrigger className="w-full bg-card">
        <SelectValue placeholder={field.placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{field.placeholder}</SelectItem>
        {field.options.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
