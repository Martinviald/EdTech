'use client';

// Dropdown multi-select genérico para la barra de filtros del dashboard
// (asignatura, nivel, curso, tipo de instrumento, momento…). Presentacional:
// recibe las opciones y los ids seleccionados, y notifica el nuevo array.
// Modelado sobre el patrón de `NodeTypeFilter` del banco de contenido.

import { ListFilter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type MultiSelectOption = { id: string; label: string };

interface MultiSelectFilterProps {
  /** Nombre del filtro en plural, usado en el texto "Limpiar …". */
  label: string;
  /** Texto del botón (la etiqueta visible la pone el FilterBar). */
  placeholder?: string;
  /** Ocupa todo el ancho de su celda (por defecto sí, para el FilterBar). */
  fullWidth?: boolean;
  options: readonly MultiSelectOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}

export function MultiSelectFilter({
  label,
  placeholder,
  fullWidth = true,
  options,
  selected,
  onChange,
}: MultiSelectFilterProps) {
  const selectedSet = new Set(selected);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn('h-9 gap-2 bg-card font-normal', fullWidth && 'w-full justify-between')}
          disabled={options.length === 0}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ListFilter className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{placeholder ?? label}</span>
          </span>
          {selected.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {selected.length}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[340px] w-64 overflow-y-auto">
        {options.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">Sin opciones</div>
        ) : (
          <>
            {options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.id}
                checked={selectedSet.has(option.id)}
                onCheckedChange={() => toggle(option.id)}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="truncate">{option.label}</span>
              </DropdownMenuCheckboxItem>
            ))}
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mt-1 flex w-full items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" aria-hidden />
                Limpiar {label}
              </button>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
