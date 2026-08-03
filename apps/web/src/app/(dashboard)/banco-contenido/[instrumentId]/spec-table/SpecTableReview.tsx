'use client';

import { useMemo, useState } from 'react';
import { LayoutGrid, ListChecks } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  TAXONOMY_NODE_TYPES,
  type ItemModel,
  type ItemTaxonomyTagModel,
  type InstrumentSectionModel,
} from '@soe/types';
import { nodeTypeLabel } from '@/lib/taxonomy-labels';
import {
  deriveEjeFacets,
  deriveTagFacets,
  filterItemsByTags,
  type TagFacet,
} from '../../tag-facets';
import { TagMultiFilter } from '../../TagMultiFilter';
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
 * Vista de REVISIÓN de la tabla de especificaciones (TKT-16 / T2-11), en dos
 * modos: MATRIZ (una fila por pregunta × una columna por tipo de nodo, con
 * filtros de encabezado por dimensión) y RESUMEN (panorama del instrumento:
 * cantidad de preguntas por cada dimensión/nodo). El N° de pregunta abre el
 * panel de detalle del ítem.
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
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [view, setView] = useState<'matriz' | 'resumen'>('matriz');

  const facets = useMemo(() => deriveTagFacets(items), [items]);
  // Eje curricular estricto = nodo padre del OA (T2-11). Dimensión extra del
  // resumen; NO entra en `facets` porque los ejes no etiquetan ítems y romperían
  // el filtro por tag de la matriz.
  const ejeFacets = useMemo(() => deriveEjeFacets(items), [items]);
  const filteredItems = useMemo(
    () => filterItemsByTags(items, selectedTagIds),
    [items, selectedTagIds],
  );

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          <Button
            type="button"
            variant={view === 'matriz' ? 'secondary' : 'ghost'}
            size="sm"
            className="gap-2"
            onClick={() => setView('matriz')}
          >
            <LayoutGrid className="size-4" aria-hidden />
            Matriz
          </Button>
          <Button
            type="button"
            variant={view === 'resumen' ? 'secondary' : 'ghost'}
            size="sm"
            className="gap-2"
            onClick={() => setView('resumen')}
          >
            <ListChecks className="size-4" aria-hidden />
            Resumen
          </Button>
        </div>
        {view === 'matriz' ? (
          <TagMultiFilter facets={facets} selected={selectedTagIds} onChange={setSelectedTagIds} />
        ) : null}
      </div>

      {view === 'resumen' ? (
        <SpecTableSummary total={items.length} facets={facets} ejeFacets={ejeFacets} />
      ) : (
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
              {filteredItems.map((item) => (
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
      )}

      <ItemDetailPanel
        canAddToCollection={canEdit}
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

/** Panorama del instrumento: cantidad de preguntas por cada dimensión y nodo. */
function SpecTableSummary({
  total,
  facets,
  ejeFacets,
}: {
  total: number;
  facets: TagFacet[];
  /** Facetas por EJE curricular estricto (padre del OA) — dimensión extra (T2-11). */
  ejeFacets: TagFacet[];
}) {
  const byType = facets.reduce<Record<string, TagFacet[]>>((acc, facet) => {
    if (facet.type === 'descriptor') return acc;
    (acc[facet.type] ??= []).push(facet);
    return acc;
  }, {});
  const types = orderNodeTypes(Object.keys(byType));
  const hasDimensions = ejeFacets.length > 0 || types.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-4 text-sm">
        <span className="font-medium">{total}</span> pregunta{total === 1 ? '' : 's'} en el
        instrumento.
      </div>
      {!hasDimensions ? (
        <p className="text-sm text-muted-foreground">
          Este instrumento aún no tiene preguntas etiquetadas por dimensión.
        </p>
      ) : (
        <>
          {/* El eje va primero: es la agrupación curricular más amplia. */}
          {ejeFacets.length > 0 ? <SummaryDimension title="Eje" facets={ejeFacets} /> : null}
          {types.map((type) => (
            <SummaryDimension
              key={type}
              title={nodeTypeLabel(type) ?? type}
              facets={byType[type]!}
            />
          ))}
        </>
      )}
    </div>
  );
}

/** Una dimensión del resumen: encabezado + lista de categorías con su conteo de preguntas. */
function SummaryDimension({ title, facets }: { title: string; facets: TagFacet[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2 text-sm font-semibold">
        <span>{title}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {facets.length} categoría{facets.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="divide-y">
        {facets.map((facet) => (
          <li
            key={facet.nodeId}
            className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
          >
            <span className="min-w-0 truncate">{facet.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{facet.count} preg.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
