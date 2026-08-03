'use client';

import type { DiaItemPreview } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { asMatchingContent } from '@/components/items/matching-content-view';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PreviewTableProps {
  items: DiaItemPreview[];
}

export function PreviewTable({ items }: PreviewTableProps) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4 text-center">
        No se encontraron items en el archivo.
      </p>
    );
  }

  return (
    <div className="max-h-96 overflow-auto rounded border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead className="w-24">Tipo</TableHead>
            <TableHead className="w-24">Clave</TableHead>
            <TableHead>Habilidad</TableHead>
            <TableHead>OA</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, idx) => (
            <TableRow key={idx}>
              <TableCell className="font-mono text-sm">{item.position}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {formatType(item.type)}
                </Badge>
              </TableCell>
              <TableCell className="font-mono font-medium">
                <CorrectAnswerCell item={item} />
              </TableCell>
              <TableCell className="text-sm">
                {item.skill ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-sm">
                {item.oa ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Un pareado no tiene una clave única: su respuesta correcta son los pares. Se
 * muestran compactos para que quepan en la celda; el detalle completo (con
 * distractores) vive en el panel del banco de ítems.
 */
function CorrectAnswerCell({ item }: { item: DiaItemPreview }) {
  const matching = asMatchingContent(item.content ?? {});
  if (!matching) return <>{item.correctKey ?? '—'}</>;

  return (
    <span className="text-xs leading-relaxed">
      {matching.correctPairs.map((pair) => `${pair.leftId}→${pair.rightId}`).join('  ')}
    </span>
  );
}

function formatType(type: string): string {
  const map: Record<string, string> = {
    multiple_choice: 'Sel. multiple',
    multi_select: 'Multi-selección',
    true_false: 'V/F',
    open_ended: 'Abierta',
    oral_reading: 'Lectura oral',
    oral_expression: 'Exp. oral',
    writing: 'Escritura',
    listening: 'Comprension',
    matching: 'Asociacion',
    ordering: 'Ordenamiento',
    gap_fill: 'Completar',
  };
  return map[type] ?? type;
}
