'use client';

// Dropdown multi-select para UN tipo de nodo de taxonomía (Descriptor, OA,
// Habilidad, Tipo de texto…). Presentacional: recibe las opciones ya acotadas por
// asignatura/nivel (desde el servidor) y notifica los ids seleccionados.
// Semántica OR entre las opciones del mismo dropdown; el padre combina cada
// dropdown con AND. Modelado sobre el bloque DropdownMenu de `TagMultiFilter`.

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

export type NodeOption = { id: string; label: string };

interface NodeTypeFilterProps {
  /** Etiqueta del tipo de nodo (p. ej. "Objetivo de aprendizaje"). */
  label: string;
  /** Texto del botón cuando se usa con una etiqueta externa (grid del FilterBar). */
  placeholder?: string;
  /** Ocupa todo el ancho de su contenedor (celda de grilla). */
  fullWidth?: boolean;
  options: NodeOption[];
  selected: string[];
  onChange: (nodeIds: string[]) => void;
}

export function NodeTypeFilter({
  label,
  placeholder,
  fullWidth,
  options,
  selected,
  onChange,
}: NodeTypeFilterProps) {
  const selectedSet = new Set(selected);

  const toggle = (nodeId: string) => {
    if (selectedSet.has(nodeId)) {
      onChange(selected.filter((id) => id !== nodeId));
    } else {
      onChange([...selected, nodeId]);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('gap-2', fullWidth && 'w-full justify-between')}
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
      <DropdownMenuContent align="start" className="max-h-[340px] w-72 overflow-y-auto">
        {options.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            Sin opciones para este filtro
          </div>
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
