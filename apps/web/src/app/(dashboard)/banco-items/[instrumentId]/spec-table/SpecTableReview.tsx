import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ItemTaxonomyTagModel, ItemTagType, TaggedBy } from '@soe/types';
import { TagBadge } from '../TagBadge';

// Respuesta de `GET /spec-tables/:instrumentId` (ítems con sus tags de taxonomía).
// El backend no expone un tipo compartido para esta forma; la declaramos acá.
export type SpecTableReviewTag = {
  id: string;
  nodeId: string;
  tagType: ItemTagType;
  confidence: string;
  taggedBy: TaggedBy;
  taggedAt: string | Date;
  node: { name: string; type: string; code: string | null };
};

export type SpecTableReviewItem = {
  id: string;
  position: number;
  type: string;
  content: Record<string, unknown>;
  scoringConfig: Record<string, unknown> | null;
  tags: SpecTableReviewTag[];
};

export type SpecTableResponse = { items: SpecTableReviewItem[] };

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
    if (typeof content[field] === 'string' && content[field]) {
      return content[field] as string;
    }
  }
  return '(Sin contenido)';
}

/** Adapta un tag de spec-table al modelo que consume `TagBadge` (DRY). */
function toTagModel(itemId: string, tag: SpecTableReviewTag): ItemTaxonomyTagModel {
  return {
    id: tag.id,
    itemId,
    nodeId: tag.nodeId,
    tagType: tag.tagType,
    confidence: tag.confidence,
    taggedBy: tag.taggedBy,
    taggedAt: tag.taggedAt,
    node: {
      id: tag.nodeId,
      name: tag.node.name,
      type: tag.node.type,
      code: tag.node.code,
    },
  };
}

/**
 * Vista de REVISIÓN de la tabla de especificaciones (TKT-16): ítem × tags de
 * taxonomía ya cargados. Lectura pura; la carga es una acción secundaria en la
 * página que la contiene.
 */
export function SpecTableReview({ items }: { items: SpecTableReviewItem[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[60px]">#</TableHead>
            <TableHead className="w-[160px]">Tipo</TableHead>
            <TableHead>Contenido</TableHead>
            <TableHead className="min-w-[240px]">Nodos de taxonomía</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-mono text-xs">{item.position}</TableCell>
              <TableCell>
                <span className="text-xs">
                  {ITEM_TYPE_LABELS[item.type] ?? item.type}
                </span>
              </TableCell>
              <TableCell className="max-w-[320px] truncate text-sm">
                {getContentPreview(item.content)}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {item.tags.length > 0 ? (
                    item.tags.map((tag) => (
                      <TagBadge key={tag.id} tag={toTagModel(item.id, tag)} />
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">Sin tags</span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
