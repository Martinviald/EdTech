'use client';

// TKT-14 — Explorador del banco de ítems global (cross-instrumento).
//
// Recibe los ítems YA filtrados por el Server Component (asignatura, nivel y tags
// de taxonomía, server-side). Solo presenta la lista y el detalle: el filtrado
// vive en `ItemBankFilters` (que reescribe la URL) y en el backend. Reutiliza
// `TagBadge` e `ItemDetailPanel` para no duplicar UI.

import { useState } from 'react';
import { Library } from 'lucide-react';
import type { ItemModel } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared';
import { TagBadge } from '../../[instrumentId]/TagBadge';
import { ItemDetailPanel } from '../../[instrumentId]/ItemDetailPanel';

const ITEM_TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Selección múltiple',
  true_false: 'Verdadero/Falso',
  open_ended: 'Desarrollo',
  oral_reading: 'Lectura oral',
  oral_expression: 'Expresión oral',
  writing: 'Escritura',
  listening: 'Comprensión auditiva',
  matching: 'Términos pareados',
  ordering: 'Ordenamiento',
  gap_fill: 'Completar',
};

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
}

export function ItemBankExplorer({ items, instrumentNames }: ItemBankExplorerProps) {
  const [detail, setDetail] = useState<ItemModel | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {items.length} ítem{items.length === 1 ? '' : 's'}
        </p>
      </div>

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
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setDetail(item)}
                  className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <ItemDetailPanel item={detail} open={detail !== null} onClose={() => setDetail(null)} />
    </div>
  );
}
