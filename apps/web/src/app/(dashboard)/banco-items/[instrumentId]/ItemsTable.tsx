'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { ItemModel, InstrumentSectionModel } from '@soe/types';
import { TagBadge } from './TagBadge';
import { ItemDetailPanel } from './ItemDetailPanel';

const ITEM_TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Seleccion multiple',
  true_false: 'Verdadero/Falso',
  open_ended: 'Desarrollo',
  oral_reading: 'Lectura oral',
  oral_expression: 'Expresion oral',
  writing: 'Escritura',
  listening: 'Comprension auditiva',
  matching: 'Terminos pareados',
  ordering: 'Ordenamiento',
  gap_fill: 'Completar',
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
  review: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  published: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  deprecated: 'bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200',
};

const ITEM_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  review: 'Revision',
  published: 'Publicado',
  deprecated: 'Obsoleto',
};

function getContentPreview(content: Record<string, unknown>): string {
  if (typeof content.stem === 'string') return content.stem;
  if (typeof content.text === 'string') return content.text;
  if (typeof content.prompt === 'string') return content.prompt;
  if (typeof content.question === 'string') return content.question;
  return '(Sin contenido)';
}

export function ItemsTable({
  items,
  sections = [],
}: {
  items: ItemModel[];
  sections?: InstrumentSectionModel[];
}) {
  const [selected, setSelected] = useState<ItemModel | null>(null);

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Este instrumento aun no tiene items.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">#</TableHead>
              <TableHead className="w-[140px]">Tipo</TableHead>
              <TableHead>Contenido</TableHead>
              <TableHead className="w-[240px]">Tags</TableHead>
              <TableHead className="w-[100px]">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={`Ver detalle de la pregunta ${item.position}`}
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setSelected(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(item);
                  }
                }}
              >
                <TableCell className="font-mono text-xs">{item.position}</TableCell>
                <TableCell>
                  <span className="text-xs">
                    {ITEM_TYPE_LABELS[item.type] ?? item.type}
                  </span>
                </TableCell>
                <TableCell className="max-w-[300px] truncate text-sm">
                  {getContentPreview(item.content)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.tags && item.tags.length > 0 ? (
                      item.tags.map((tag) => <TagBadge key={tag.id} tag={tag} />)
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin tags</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`border-0 text-[10px] ${ITEM_STATUS_COLORS[item.status] ?? ''}`}
                  >
                    {ITEM_STATUS_LABELS[item.status] ?? item.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ItemDetailPanel
        item={selected}
        sections={sections}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
