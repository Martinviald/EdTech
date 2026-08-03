'use client';

import { ITEM_TYPE_LABELS } from '@soe/types';
// TKT-14 — Explorador del banco de ítems global (cross-instrumento).
//
// Recibe los ítems YA filtrados por el Server Component (asignatura, nivel y tags
// de taxonomía, server-side). Presenta la lista y el detalle, y permite seleccionar
// varios ítems para guardarlos en una lista/colección (T2-22). El filtrado vive en
// `ItemBankFilters` (que reescribe la URL) y en el backend.

import { useState } from 'react';
import { Library, ListPlus } from 'lucide-react';
import type { ItemCollectionModel, ItemModel } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared';
import { TagBadge } from '../../[instrumentId]/TagBadge';
import { ItemDetailPanel } from '../../[instrumentId]/ItemDetailPanel';
import { SaveToCollectionDialog } from './SaveToCollectionDialog';

function getContentPreview(content: Record<string, unknown>): string {
  for (const field of ['stem', 'text', 'prompt', 'question'] as const) {
    const value = content[field];
    if (typeof value === 'string' && value) return value;
  }
  return '(Sin contenido)';
}

interface ItemBankExplorerProps {
  items: ItemModel[];
  /** Mapa instrumentId → nombre del instrumento, para dar contexto cross-instrumento. */
  instrumentNames: Record<string, string>;
  /** Listas de la org a las que se pueden agregar ítems (T2-22). */
  collections: ItemCollectionModel[];
  /** Habilita la selección múltiple + "Guardar en lista" (solo roles de gestión). */
  canManageCollections: boolean;
}

export function ItemBankExplorer({
  items,
  instrumentNames,
  collections,
  canManageCollections,
}: ItemBankExplorerProps) {
  const [detail, setDetail] = useState<ItemModel | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveOpen, setSaveOpen] = useState(false);

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {items.length} ítem{items.length === 1 ? '' : 's'}
        </p>
        {canManageCollections && items.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-input"
            />
            Seleccionar todo
          </label>
        )}
      </div>

      {canManageCollections && selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3">
          <span className="text-sm font-medium">
            {selected.size} ítem{selected.size === 1 ? '' : 's'} seleccionado
            {selected.size === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={clearSelection}>
              Limpiar
            </Button>
            <Button size="sm" onClick={() => setSaveOpen(true)}>
              <ListPlus className="mr-1 h-4 w-4" />
              Guardar en lista
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={Library}
          title="Sin ítems para el filtro"
          description="Ningún ítem coincide con los filtros seleccionados. Ajusta o limpia los filtros."
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {items.map((item) => {
            const instrumentName = item.instrumentId
              ? (instrumentNames[item.instrumentId] ?? 'Instrumento')
              : 'Ítem sin instrumento';
            return (
              <li key={item.id} className="flex items-stretch">
                {canManageCollections && (
                  <label className="flex items-center pl-3">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="h-4 w-4 rounded border-input"
                      aria-label="Seleccionar ítem"
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => setDetail(item)}
                  className="flex flex-1 items-start gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="mt-0.5 w-8 shrink-0 font-mono text-xs text-muted-foreground">
                    #{item.position}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm">{getContentPreview(item.content)}</p>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="max-w-[240px] truncate text-[10px]">
                        {instrumentName}
                      </Badge>
                      {item.tags && item.tags.length > 0 ? (
                        item.tags.map((tag) => <TagBadge key={tag.id} tag={tag} />)
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin tags</span>
                      )}
                    </div>
                  </div>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {ITEM_TYPE_LABELS[item.type] ?? item.type}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ItemDetailPanel
        item={detail}
        instrumentName={
          detail
            ? detail.instrumentId
              ? (instrumentNames[detail.instrumentId] ?? 'Instrumento')
              : 'Ítem sin instrumento'
            : undefined
        }
        open={detail !== null}
        onClose={() => setDetail(null)}
      />

      {canManageCollections && (
        <SaveToCollectionDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          itemIds={[...selected]}
          collections={collections}
          onSaved={clearSelection}
        />
      )}
    </div>
  );
}
