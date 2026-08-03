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

// `hint` marca una opción que existe pero no tiene datos en el alcance actual
// (ej. un momento que ningún instrumento del colegio declara). Se anota en vez de
// deshabilitarse: el usuario puede seleccionarla igual, y el vacío de la vista le
// explica por qué no hay nada.
export type MultiSelectOption = { id: string; label: string; hint?: string };

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
                <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                  <span className="truncate">{option.label}</span>
                  {option.hint && (
                    <span className="shrink-0 text-2xs text-muted-foreground">{option.hint}</span>
                  )}
                </span>
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
