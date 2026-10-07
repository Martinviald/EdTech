'use client';

// Menú de filtros compacto, al estilo de Linear: un solo botón "Filtros" abre la
// lista de dimensiones y cada dimensión abre sus valores. Los filtros aplicados se
// muestran aparte, como chips removibles (`ActiveFilterChips`): en una vista de
// analítica, esconder qué está filtrando los datos llevaría a leer mal los números.

import { useState, type ComponentType } from 'react';
import { Check, ListFilter, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { MultiSelectOption } from './MultiSelectFilter';

/** Desde cuántas opciones la dimensión muestra un buscador dentro del submenú. */
const SEARCH_THRESHOLD = 8;

export type FilterDimension = {
  /** Clave estable (la del parámetro de la URL). */
  key: string;
  /** Nombre en singular, para el menú y el chip ("Asignatura"). */
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** `single`: elegir un valor reemplaza al anterior. `multi`: se acumulan. */
  mode: 'single' | 'multi';
  options: readonly MultiSelectOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  /** Oculta la dimensión (p. ej. cuando no aplica al alcance actual). */
  hidden?: boolean;
};

export function FilterMenu({
  dimensions,
  className,
}: {
  dimensions: readonly FilterDimension[];
  className?: string;
}) {
  const visible = dimensions.filter((d) => !d.hidden);
  const activeCount = visible.filter((d) => d.selected.length > 0).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn('h-9 gap-2 bg-card font-normal', className)}>
          <ListFilter className="size-4" aria-hidden />
          Filtros
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-2xs">
              {activeCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Filtrar por
        </DropdownMenuLabel>
        {visible.map((dimension) => (
          <DimensionSubmenu key={dimension.key} dimension={dimension} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DimensionSubmenu({ dimension }: { dimension: FilterDimension }) {
  const [query, setQuery] = useState('');
  const Icon = dimension.icon;
  const selectedSet = new Set(dimension.selected);
  const normalized = query.trim().toLocaleLowerCase('es');
  const options = normalized
    ? dimension.options.filter((o) => o.label.toLocaleLowerCase('es').includes(normalized))
    : dimension.options;

  const toggle = (id: string) => {
    if (dimension.mode === 'single') {
      dimension.onChange(selectedSet.has(id) ? [] : [id]);
      return;
    }
    dimension.onChange(
      selectedSet.has(id)
        ? dimension.selected.filter((s) => s !== id)
        : [...dimension.selected, id],
    );
  };

  return (
    <DropdownMenuSub onOpenChange={(open) => !open && setQuery('')}>
      <DropdownMenuSubTrigger disabled={dimension.options.length === 0} className="gap-2">
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
        <span className="flex-1 truncate">{dimension.label}</span>
        {dimension.selected.length > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-2xs">
            {dimension.selected.length}
          </Badge>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[360px] w-72 overflow-y-auto">
        {dimension.options.length > SEARCH_THRESHOLD && (
          <div className="p-1" onKeyDown={(e) => e.stopPropagation()}>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar ${dimension.label.toLocaleLowerCase('es')}`}
              aria-label={`Buscar ${dimension.label.toLocaleLowerCase('es')}`}
              className="h-8"
              autoFocus
            />
          </div>
        )}
        {options.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">Sin resultados</div>
        ) : (
          options.map((option) =>
            dimension.mode === 'multi' ? (
              <DropdownMenuCheckboxItem
                key={option.id}
                checked={selectedSet.has(option.id)}
                onCheckedChange={() => toggle(option.id)}
                onSelect={(e) => e.preventDefault()}
              >
                <OptionLabel option={option} />
              </DropdownMenuCheckboxItem>
            ) : (
              <DropdownMenuItem
                key={option.id}
                onSelect={() => toggle(option.id)}
                className="gap-2"
              >
                <Check
                  className={cn('size-4', selectedSet.has(option.id) ? 'opacity-100' : 'opacity-0')}
                  aria-hidden
                />
                <OptionLabel option={option} />
              </DropdownMenuItem>
            ),
          )
        )}
        {dimension.selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => dimension.onChange([])}
              className="gap-2 text-xs text-muted-foreground"
            >
              <X className="size-3" aria-hidden />
              Quitar filtro de {dimension.label.toLocaleLowerCase('es')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function OptionLabel({ option }: { option: MultiSelectOption }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
      <span className="truncate">{option.label}</span>
      {option.hint && (
        <span className="shrink-0 text-2xs text-muted-foreground">{option.hint}</span>
      )}
    </span>
  );
}

/** Cuántos valores nombra un chip antes de resumir el resto como "+N". */
const CHIP_NAMED_VALUES = 2;

/**
 * Los filtros aplicados, uno por dimensión, como chips con su botón para quitarlo.
 * No renderiza nada si no hay filtros: así no reserva espacio en la vista.
 */
export function ActiveFilterChips({
  dimensions,
  onClearAll,
  className,
}: {
  dimensions: readonly FilterDimension[];
  onClearAll?: () => void;
  className?: string;
}) {
  const active = dimensions.filter((d) => !d.hidden && d.selected.length > 0);
  if (active.length === 0) return null;

  return (
    <ul
      className={cn('flex flex-wrap items-center gap-2', className)}
      aria-label="Filtros aplicados"
    >
      {active.map((dimension) => {
        const labels = new Map(dimension.options.map((o) => [o.id, o.label]));
        const names = dimension.selected.map((id) => labels.get(id) ?? id);
        const shown = names.slice(0, CHIP_NAMED_VALUES).join(', ');
        const rest = names.length - CHIP_NAMED_VALUES;
        const text = rest > 0 ? `${shown} +${rest}` : shown;
        return (
          <li
            key={dimension.key}
            className="flex max-w-full items-center gap-1 rounded-md border bg-card py-0.5 pl-2 pr-0.5 text-xs"
          >
            <span className="text-muted-foreground">{dimension.label}:</span>
            <span className="max-w-[16rem] truncate font-medium" title={names.join(', ')}>
              {text}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              onClick={() => dimension.onChange([])}
              aria-label={`Quitar filtro de ${dimension.label.toLocaleLowerCase('es')}`}
              title="Quitar filtro"
            >
              <X className="size-3" aria-hidden />
            </Button>
          </li>
        );
      })}
      {onClearAll && active.length > 1 && (
        <li>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={onClearAll}
          >
            Limpiar filtros
          </Button>
        </li>
      )}
    </ul>
  );
}
