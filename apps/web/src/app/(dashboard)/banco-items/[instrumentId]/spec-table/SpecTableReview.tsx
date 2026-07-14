'use client';

import { useMemo, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  TAXONOMY_NODE_TYPES,
  type ItemModel,
  type ItemTaxonomyTagModel,
  type InstrumentSectionModel,
} from '@soe/types';
import { nodeTypeLabel } from '@/lib/taxonomy-labels';
import { TagBadge } from '../TagBadge';
import { ItemDetailPanel } from '../ItemDetailPanel';
import { NodeDetailDialog } from './NodeDetailDialog';

/** Orden canónico de las columnas por tipo de nodo (según el enum de taxonomía). */
const NODE_TYPE_ORDER: Record<string, number> = Object.fromEntries(
  TAXONOMY_NODE_TYPES.map((type, index) => [type, index]),
);

function orderNodeTypes(types: string[]): string[] {
  return [...types].sort((a, b) => {
    const ia = NODE_TYPE_ORDER[a] ?? Number.MAX_SAFE_INTEGER;
    const ib = NODE_TYPE_ORDER[b] ?? Number.MAX_SAFE_INTEGER;
    return ia === ib ? a.localeCompare(b) : ia - ib;
  });
}

/**
 * Vista de REVISIÓN de la tabla de especificaciones (TKT-16), en formato matriz:
 * una fila por pregunta y una columna por cada tipo de nodo de clasificación
 * (OA, habilidad, contenido, tipo de texto…) presente en el instrumento. Cada
 * celda muestra los nodos de ese tipo vinculados a la pregunta.
 *
 * El N° de pregunta es clickeable y abre el panel de detalle del ítem (mismo
 * panel que la tabla de ítems del instrumento).
 */
export function SpecTableReview({
  items,
  sections = [],
  canEdit = false,
  instrumentId,
}: {
  items: ItemModel[];
  sections?: InstrumentSectionModel[];
  canEdit?: boolean;
  instrumentId: string;
}) {
  const [selected, setSelected] = useState<ItemModel | null>(null);
  const [selectedTag, setSelectedTag] = useState<ItemTaxonomyTagModel | null>(null);

  // Tipos de nodo presentes en el instrumento → columnas de la matriz.
  const nodeTypes = useMemo(() => {
    const present = new Set<string>();
    for (const item of items) {
      for (const tag of item.tags ?? []) {
        present.add(tag.node?.type ?? 'unknown');
      }
    }
    return orderNodeTypes([...present]);
  }, [items]);

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">N° pregunta</TableHead>
              {nodeTypes.length > 0 ? (
                nodeTypes.map((type) => (
                  <TableHead key={type} className="min-w-[160px]">
                    {nodeTypeLabel(type) ?? type}
                  </TableHead>
                ))
              ) : (
                <TableHead className="min-w-[240px]">Nodos de taxonomía</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="align-top">
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    aria-label={`Ver detalle de la pregunta ${item.position}`}
                    className="rounded-sm font-mono text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.position}
                  </button>
                </TableCell>
                {nodeTypes.length > 0 ? (
                  nodeTypes.map((type) => {
                    const tags = (item.tags ?? []).filter(
                      (tag) => (tag.node?.type ?? 'unknown') === type,
                    );
                    return (
                      <TableCell key={type} className="align-top">
                        {tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {tags.map((tag) => (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => setSelectedTag(tag)}
                                aria-label={`Ver detalle del nodo ${tag.node?.name ?? ''}`}
                                className="rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <TagBadge tag={tag} />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  })
                ) : (
                  <TableCell className="align-top">
                    <span className="text-xs text-muted-foreground">Sin nodos vinculados</span>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ItemDetailPanel
        item={selected}
        sections={sections}
        canEdit={canEdit}
        instrumentId={instrumentId}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />

      <NodeDetailDialog
        tag={selectedTag}
        open={selectedTag !== null}
        onClose={() => setSelectedTag(null)}
      />
    </>
  );
}
