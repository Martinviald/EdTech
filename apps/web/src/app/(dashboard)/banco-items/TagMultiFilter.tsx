'use client';

// TKT-12 / TKT-14 — Filtro multi-tag reutilizable con lógica OR.
//
// Componente presentacional puro: recibe las facetas disponibles, el conjunto
// seleccionado y notifica cambios. NO deriva ni filtra por sí mismo (eso vive
// en `tag-facets.ts`), para poder reusarse tanto en la tabla de ítems de un
// instrumento como en el banco de ítems global.
//
// Semántica OR: un ítem coincide si tiene CUALQUIERA de los nodos seleccionados.
//
// UI: se renderiza un dropdown independiente por cada categoría (tipo de nodo)
// presente en el instrumento — no un único dropdown con todas las categorías.
// La categoría `descriptor` no se expone como filtro (metadata de banco/IA).

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
import { nodeTypeLabel } from '@/lib/taxonomy-labels';
import type { TagFacet } from './tag-facets';

/** Categorías de nodo que no se exponen como filtro en el banco de ítems. */
const HIDDEN_FILTER_NODE_TYPES = new Set<string>(['descriptor']);

interface TagMultiFilterProps {
  facets: TagFacet[];
  selected: string[];
  onChange: (nodeIds: string[]) => void;
  className?: string;
}

export function TagMultiFilter({ facets, selected, onChange, className }: TagMultiFilterProps) {
  const selectedSet = new Set(selected);

  const toggle = (nodeId: string) => {
    if (selectedSet.has(nodeId)) {
      onChange(selected.filter((id) => id !== nodeId));
    } else {
      onChange([...selected, nodeId]);
    }
  };

  // Agrupar facetas por tipo de nodo (excluyendo categorías ocultas),
  // preservando el orden ya establecido en `deriveTagFacets`.
  const groups = facets.reduce<Record<string, TagFacet[]>>((acc, facet) => {
    if (HIDDEN_FILTER_NODE_TYPES.has(facet.type)) return acc;
    (acc[facet.type] ??= []).push(facet);
    return acc;
  }, {});
  const groupTypes = Object.keys(groups);

  const selectedFacets = selected
    .map((id) => facets.find((f) => f.nodeId === id))
    .filter((f): f is TagFacet => f !== undefined && !HIDDEN_FILTER_NODE_TYPES.has(f.type));

  if (groupTypes.length === 0) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        <Button variant="outline" size="sm" className="gap-2" disabled>
          <ListFilter className="size-4" aria-hidden />
          Filtrar por tags
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {groupTypes.map((type) => {
        const groupFacets = groups[type]!;
        const groupSelectedCount = groupFacets.reduce(
          (n, f) => (selectedSet.has(f.nodeId) ? n + 1 : n),
          0,
        );
        return (
          <DropdownMenu key={type}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <ListFilter className="size-4" aria-hidden />
                {nodeTypeLabel(type)}
                {groupSelectedCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                    {groupSelectedCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[340px] w-72 overflow-y-auto">
              {groupFacets.map((facet) => (
                <DropdownMenuCheckboxItem
                  key={facet.nodeId}
                  checked={selectedSet.has(facet.nodeId)}
                  onCheckedChange={() => toggle(facet.nodeId)}
                  onSelect={(e) => e.preventDefault()}
                >
                  <span className="truncate">{facet.label}</span>
                  <span className="ml-auto pl-2 text-xs text-muted-foreground">{facet.count}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}

      {selectedFacets.map((facet) => (
        <Badge key={facet.nodeId} variant="outline" className="gap-1 pr-1 text-[10px] font-medium">
          {facet.label}
          <button
            type="button"
            onClick={() => toggle(facet.nodeId)}
            className="rounded-sm p-0.5 hover:bg-muted"
            aria-label={`Quitar filtro ${facet.label}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </Badge>
      ))}

      {selectedFacets.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => onChange([])}
        >
          <X className="size-3" aria-hidden />
          Limpiar
        </Button>
      )}
    </div>
  );
}
